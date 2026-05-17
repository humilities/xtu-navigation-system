require('dotenv').config();
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { findShortestPath } = require('./navigation');

const app = express();
const upload = multer({ dest: 'uploads/' });

// --- 数据库连接配置 ---
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('❌ 数据库连接失败：', err.message);
    else console.log('✅ 数据库连接成功！当前时间：', res.rows[0].now);
});

// --- 中间件配置 ---
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 因为你的 index.js 在 navi-server 里，而 index.html 在根目录，所以用 '..' 向上跳一级
app.use(express.static(path.join(__dirname, '../3d')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 管理员权限验证中间件 (核心：门卫)
const adminAuth = (req, res, next) => {
    const token = req.headers['x-admin-token'];
    if (token && token === process.env.ADMIN_SECRET_KEY) {
        next();
    } else {
        console.warn(`🚨 未授权尝试！来源 IP: ${req.ip}`);
        res.status(403).json({ error: '权限不足：只有湘大导航系统管理员可操作' });
    }
};

// 1. 公共接口 

// 获取所有建筑 (用于 Mapbox 渲染)
app.get('/api/map/buildings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM locations ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '无法获取建筑列表' });
    }
});

// 搜索接口：支持模糊匹配并对齐前端字段名
// ⚠️ 必须在 /api/locations/:id 之前注册，否则 Express 会把 'search' 当作 :id 参数
app.get('/api/locations/search', async (req, res) => {
    const { keyword } = req.query;
    if (!keyword) return res.json([]);
    try {
        const query = `
            SELECT id, name, category, longitude as lng, latitude as lat 
            FROM locations 
            WHERE name ILIKE $1 OR description ILIKE $1 
            LIMIT 5
        `;
        const result = await pool.query(query, [`%${keyword}%`]);
        res.json(result.rows); // 确保返回的是 [{id, name, lng, lat}, ...]
    } catch (err) {
        console.error('搜索出错:', err);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 获取地点详情 (聚合照片、评论、失物)
// ⚠️ 必须在 /api/locations/search 之后注册，避免路由冲突
app.get('/api/locations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT l.*,
                COALESCE((SELECT json_agg(p) FROM location_photos p WHERE p.location_id = l.id), '[]') as photos,
                COALESCE((SELECT json_agg(r) FROM location_reviews r WHERE r.location_id = l.id AND r.status = 1), '[]') as reviews,
                COALESCE((SELECT json_agg(lf) FROM lost_and_found lf WHERE lf.location_id = l.id AND lf.status = 1), '[]') as lost_found
            FROM locations l WHERE l.id = $1
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) return res.status(404).json({ message: '地点不存在' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send('服务器内部错误');
    }
});

// 路径规划
app.get('/api/navigation/route', async (req, res) => {
    const { start, end } = req.query;
    // 转换并检查是否为有效数字
    const startId = parseInt(start);
    const endId = parseInt(end);

    if (isNaN(startId) || isNaN(endId)) {
        return res.status(400).json({ message: '起点或终点ID无效' });
    }

    try {
        const hour = new Date().getHours();
        let costField = 'cost_noon';
        if (hour >= 6 && hour < 11) costField = 'cost_morning';
        else if (hour >= 17 && hour < 22) costField = 'cost_evening';

        const { rows: edges } = await pool.query(`SELECT source_node, target_node, ${costField} as weight FROM view_bidirectional_paths`);
        const result = findShortestPath(edges, parseInt(start), parseInt(end));

        const { rows: coords } = await pool.query(
            `SELECT id, longitude as lng, latitude as lat FROM locations WHERE id = ANY($1) ORDER BY array_position($1, id)`,
            [result.nodes]
        );

        res.json({
            period: costField,
            pathNodes: result.nodes,
            coordinates: coords.map(c => [parseFloat(c.lng), parseFloat(c.lat)]),
            totalCost: result.cost
        });
    } catch (err) {
        res.status(500).json({ message: '路径计算失败' });
    }
});

// 获取所有路径连线 (用于地图初始化显示)
app.get('/api/map/edges', async (req, res) => {
    try {
        const query = `
            SELECT p.source_node, p.target_node, 
                   l1.longitude as start_lng, l1.latitude as start_lat,
                   l2.longitude as end_lng, l2.latitude as end_lat,
                   p.cost_noon as flow_weight
            FROM view_bidirectional_paths p
            JOIN locations l1 ON p.source_node = l1.id
            JOIN locations l2 ON p.target_node = l2.id
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '无法获取路径数据' });
    }
});

// 2. 用户投稿接口 (所有人可用，默认 status=0)

app.post('/api/reviews', async (req, res) => {
    const { location_id, user_nickname, rating, comment } = req.body;
    if (!location_id || !rating || !comment) return res.status(400).json({ error: '信息不完整' });
    try {
        await pool.query(
            `INSERT INTO location_reviews (location_id, user_nickname, rating, comment, status) VALUES ($1, $2, $3, $4, 0)`,
            [location_id, user_nickname || '匿名同学', rating, comment]
        );
        res.json({ message: '评价提交成功，等待管理员审核' });
    } catch (err) {
        res.status(500).json({ error: '提交失败' });
    }
});

app.post('/api/lost-found', async (req, res) => {
    const { location_id, type, item_name, description, contact } = req.body;
    try {
        await pool.query(
            `INSERT INTO lost_and_found (location_id, type, item_name, description, contact, status) VALUES ($1, $2, $3, $4, $5, 0)`,
            [location_id, type, item_name, description, contact]
        );
        res.json({ message: '信息已记录，待审核' });
    } catch (err) {
        res.status(500).json({ error: '发布失败' });
    }
});

// 3. 管理员接口 (需要 adminAuth 验证)

// 获取所有待审核内容
app.get('/api/admin/pending', adminAuth, async (req, res) => {
    try {
        const reviews = await pool.query('SELECT * FROM location_reviews WHERE status = 0');
        const lostFound = await pool.query('SELECT * FROM lost_and_found WHERE status = 0');
        res.json({ pending_reviews: reviews.rows, pending_lost_found: lostFound.rows });
    } catch (err) {
        res.status(500).json({ error: '获取列表失败' });
    }
});


// 通用一键审核通过
app.patch('/api/admin/approve/:type/:id', adminAuth, async (req, res) => {
    const { type, id } = req.params;
    const tableMap = { 'reviews': 'location_reviews', 'lost-found': 'lost_and_found' };
    if (!tableMap[type]) return res.status(400).json({ error: '无效类型' });

    try {
        await pool.query(`UPDATE ${tableMap[type]} SET status = 1 WHERE id = $1`, [id]);
        res.json({ message: '审核已通过' });
    } catch (err) {
        res.status(500).json({ error: '操作失败' });
    }
});

// 更新地点信息
app.put('/api/admin/locations/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, longitude, latitude, height, description, category } = req.body;
    try {
        const query = `UPDATE locations SET name=COALESCE($1,name), longitude=COALESCE($2,longitude), latitude=COALESCE($3,latitude), 
                       height=COALESCE($4,height), description=COALESCE($5,description), category=COALESCE($6,category) WHERE id=$7`;
        await pool.query(query, [name, longitude, latitude, height, description, category, id]);
        res.json({ message: '地点更新成功' });
    } catch (err) {
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除评论
app.delete('/api/admin/reviews/:id', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM location_reviews WHERE id = $1', [req.params.id]);
        res.json({ message: '已删除' });
    } catch (err) {
        res.status(500).json({ error: '删除失败' });
    }
});


// 删除失物招领（管理员拒绝时使用）
app.delete('/api/admin/lost-found/:id', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM lost_and_found WHERE id = $1', [req.params.id]);
        res.json({ message: '已删除' });
    } catch (err) {
        res.status(500).json({ error: '删除失败' });
    }
});

// 管理员上传照片
app.post('/api/admin/locations/:id/photo', adminAuth, upload.single('image'), async (req, res) => {
    const imageUrl = `/uploads/${req.file.filename}`;
    try {
        await pool.query('INSERT INTO location_photos (location_id, url) VALUES ($1, $2)', [req.params.id, imageUrl]);
        res.json({ success: true, url: imageUrl });
    } catch (err) {
        res.status(500).json({ error: '图片保存失败' });
    }
});


// 删除照片
app.delete('/api/admin/photos/:id', adminAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT url FROM location_photos WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: '照片不存在' });
        await pool.query('DELETE FROM location_photos WHERE id = $1', [req.params.id]);
        res.json({ message: '照片已删除' });
    } catch (err) {
        res.status(500).json({ error: '删除失败' });
    }
});


// 新增建筑/地点
app.post('/api/admin/locations', adminAuth, async (req, res) => {
    const { name, longitude, latitude, height, description, category } = req.body;
    if (!name || longitude == null || latitude == null) {
        return res.status(400).json({ error: '名称、经度、纬度为必填项' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO locations (name, longitude, latitude, height, description, category)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, longitude, latitude, height || 0, description || '', category || '']
        );
        res.json({ message: '建筑新增成功', location: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增失败' });
    }
});

// 删除建筑（级联删除照片、评价、失物招领、边）
app.delete('/api/admin/locations/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM location_photos  WHERE location_id = $1', [id]);
        await pool.query('DELETE FROM location_reviews WHERE location_id = $1', [id]);
        await pool.query('DELETE FROM lost_and_found   WHERE location_id = $1', [id]);
        await pool.query('DELETE FROM edges WHERE source_node = $1 OR target_node = $1', [id]);
        await pool.query('DELETE FROM locations WHERE id = $1', [id]);
        res.json({ message: '建筑及关联数据已删除' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '删除失败' });
    }
});


// 获取所有边（含端点名称）
app.get('/api/admin/edges', adminAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT e.id, e.source_node, e.target_node,
                   l1.name AS source_name, l2.name AS target_name,
                   e.cost_morning, e.cost_noon, e.cost_evening
            FROM edges e
            JOIN locations l1 ON e.source_node = l1.id
            JOIN locations l2 ON e.target_node = l2.id
            ORDER BY e.id ASC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: '获取边列表失败' });
    }
});

// 新增边
app.post('/api/admin/edges', adminAuth, async (req, res) => {
    const { source_node, target_node, cost_morning, cost_noon, cost_evening } = req.body;
    if (!source_node || !target_node) {
        return res.status(400).json({ error: '起点ID和终点ID为必填项' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO edges (source_node, target_node, cost_morning, cost_noon, cost_evening)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [source_node, target_node,
             cost_morning ?? 1, cost_noon ?? 1, cost_evening ?? 1]
        );
        res.json({ message: '边新增成功', edge: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '新增失败，请确认节点ID存在' });
    }
});


// 更新边权重（三个时段）
app.put('/api/admin/edges/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { cost_morning, cost_noon, cost_evening } = req.body;
    try {
        await pool.query(
            `UPDATE edges SET
                cost_morning = COALESCE($1, cost_morning),
                cost_noon    = COALESCE($2, cost_noon),
                cost_evening = COALESCE($3, cost_evening)
             WHERE id = $4`,
            [cost_morning, cost_noon, cost_evening, id]
        );
        res.json({ message: '边权重更新成功' });
    } catch (err) {
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除边
app.delete('/api/admin/edges/:id', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM edges WHERE id = $1', [req.params.id]);
        res.json({ message: '边已删除' });
    } catch (err) {
        res.status(500).json({ error: '删除失败' });
    }
});

// --- 启动服务器 ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 湘大导航系统后端运行在 http://localhost:${PORT}`);
});