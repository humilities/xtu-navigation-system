require('dotenv').config();
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { findShortestPath } = require('./utils/navigation');
const app = express();

// 添加这行测试代码，启动时看终端输出什么
console.log("调试 - 密码是否读取成功:", process.env.DB_PASSWORD ? "是" : "否");

// --- 中间件配置 ---
app.use(cors()); 
app.use(express.json());
// 托管静态资源，确保 navi-server 目录下有 uploads 文件夹
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 数据库连接配置 ---
// 建议：如果有了 .env 文件，可以使用 process.env.DB_PASSWORD 等替代硬编码
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD, // 从 .env 文件读取
  port: process.env.DB_PORT || 5432,
});

// --- 测试连接 (注意：千万不要在这里调用 pool.end()) ---
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ 数据库连接失败：', err.message);
  } else {
    console.log('✅ 数据库连接成功！当前时间：', res.rows[0].now);
  }
  // 这里绝对不能写 pool.end()，否则接口会无法使用
});

// --- API 路由 ---

// 1. 获取所有建筑（用于 Mapbox 3D 渲染）
app.get('/api/map/buildings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM locations ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '无法获取建筑列表' });
  }
});

// 2. 获取地点详情（聚合查询照片、评论、失物招领）
app.get('/api/locations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT 
        l.*,
        -- 使用 COALESCE 处理 null 确保前端拿到的是空数组而不是 null
        COALESCE((SELECT json_agg(p) FROM location_photos p WHERE p.location_id = l.id), '[]') as photos,
        COALESCE((SELECT json_agg(r) FROM location_reviews r WHERE r.location_id = l.id AND r.status = 1), '[]') as reviews,
        COALESCE((SELECT json_agg(lf) FROM lost_and_found lf WHERE lf.location_id = l.id AND lf.status = 1), '[]') as lost_found
      FROM locations l
      WHERE l.id = $1
    `;
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: '地点不存在' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ 获取详情失败:', err);
    res.status(500).send('服务器内部错误');
  }
});

//3.查询最短路径
app.get('/api/navigation/route', async (req, res) => {
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({ message: '缺少起点或终点' });
    }

    try {
        // A. 自动判断当前时间段
        const hour = new Date().getHours();
        let costField = 'cost_noon'; // 默认中午
        if (hour >= 6 && hour < 11) costField = 'cost_morning';
        else if (hour >= 17 && hour < 22) costField = 'cost_evening';

        // B. 从视图中拉取数据
        // 视图已经帮我们处理好了 A->B 和 B->A 的逻辑
        const query = `SELECT source_node, target_node, ${costField} as weight FROM view_bidirectional_paths`;
        const { rows: edges } = await pool.query(query);

        // C. 执行计算
        const result = findShortestPath(edges, parseInt(start), parseInt(end));

        // D. 聚合路径节点的详细坐标 (方便前端 Mapbox 直接绘线)
        const nodeCoordsQuery = `
            SELECT id, longitude as lng, latitude as lat 
            FROM locations 
            WHERE id = ANY($1)
            ORDER BY array_position($1, id)
        `;
        const { rows: coords } = await pool.query(nodeCoordsQuery, [result.nodes]);

        res.json({
            period: costField,
            pathNodes: result.nodes,
            coordinates: coords.map(c => [parseFloat(c.lng), parseFloat(c.lat)]),
            totalCost: result.cost
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: '路径计算失败' });
    }
});

//搜索优化接口 用户可以通过输入文字来查找
app.get('/api/locations/search', async (req, res) => {
    const { keyword } = req.query;
    if (!keyword) return res.json([]);
    try {
        const query = `
            SELECT id, name, category, longitude as lng, latitude as lat 
            FROM locations 
            WHERE name ILIKE $1 OR description ILIKE $1 
            LIMIT 10
        `;
        const result = await pool.query(query, [`%${keyword}%`]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: '搜索失败' });
    }
});

//用户投稿接口 失物招领与点评 只需要允许普通学生提交内容 但这些内容的初始状态=0
//失物招领投稿 POST /api/lost-found
//建筑点评投稿 POST /api/reviews
app.post('/api/reviews', async (req, res) => {
    const { location_id, user_nickname, rating, comment } = req.body;
    try {
        await pool.query(
            `INSERT INTO location_reviews (location_id, user_nickname, rating, comment, status) 
             VALUES ($1, $2, $3, $4, 0)`, 
            [location_id, user_nickname, rating, comment]
        );
        res.json({ message: '评价提交成功，等待管理员审核' });
    } catch (err) {
        res.status(500).json({ error: '提交失败' });
    }
});

//管理员图片上传接口 安装依赖 npm install multer
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// 管理员为地点上传照片
app.post('/api/admin/locations/:id/photo', upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const imageUrl = `/uploads/${req.file.filename}`; // 生成访问路径
    
    try {
        await pool.query(
            'INSERT INTO location_photos (location_id, url) VALUES ($1, $2)',
            [id, imageUrl]
        );
        res.json({ success: true, url: imageUrl });
    } catch (err) {
        res.status(500).json({ error: '图片保存失败' });
    }
});

// --- 用户投稿模块 ---

// 1. 提交建筑点评
app.post('/api/reviews', async (req, res) => {
    const { location_id, user_nickname, rating, comment } = req.body;
    
    // 基础校验
    if (!location_id || !rating || !comment) {
        return res.status(400).json({ error: '请填写完整评价信息' });
    }

    try {
        const query = `
            INSERT INTO location_reviews (location_id, user_nickname, rating, comment, status) 
            VALUES ($1, $2, $3, $4, 0) -- 默认 status=0 待审核
            RETURNING id
        `;
        const result = await pool.query(query, [location_id, user_nickname || '匿名同学', rating, comment]);
        res.json({ message: '感谢评价！内容将在管理员审核后显示。', reviewId: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '提交评价失败' });
    }
});

// 2. 发布失物招领
app.post('/api/lost-found', async (req, res) => {
    const { location_id, type, item_name, description, contact } = req.body;
    
    try {
        await pool.query(
            `INSERT INTO lost_and_found (location_id, type, item_name, description, contact, status) 
             VALUES ($1, $2, $3, $4, $5, 0)`,
            [location_id, type, item_name, description, contact]
        );
        res.json({ message: '失物信息已记录，审核通过后将出现在地图详情中。' });
    } catch (err) {
        res.status(500).json({ error: '发布失败' });
    }
});

// --- 空间数据与内容维护模块 (管理员专供) ---

/**
 * 1. 更新地点信息 (坐标、名称、描述、高度)
 * 用途：校内建筑更名、施工导致坐标微调、或高度数据更新
 */
app.put('/api/admin/locations/:id', async (req, res) => {
    const { id } = req.params;
    const { name, longitude, latitude, height, description, category } = req.body;

    try {
        const query = `
            UPDATE locations 
            SET 
                name = COALESCE($1, name),
                longitude = COALESCE($2, longitude),
                latitude = COALESCE($3, latitude),
                height = COALESCE($4, height),
                description = COALESCE($5, description),
                category = COALESCE($6, category)
            WHERE id = $7
            RETURNING *
        `;
        const values = [name, longitude, latitude, height, description, category, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '未找到该建筑 ID' });
        }

        console.log(`✅ 建筑数据已更新: ${result.rows[0].name}`);
        res.json({ message: '地点数据更新成功', data: result.rows[0] });
    } catch (err) {
        console.error('❌ 更新地点失败:', err);
        res.status(500).json({ error: '数据库更新失败' });
    }
});

/**
 * 2. 删除违规评论
 * 用途：管理员清理不当言论，维护校园环境
 */
app.delete('/api/admin/reviews/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM location_reviews WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '未找到该评论' });
        }

        res.json({ message: '评论已成功移除', deletedReview: result.rows[0] });
    } catch (err) {
        console.error('❌ 删除评论失败:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

/**
 * 3. 通用审核接口 (审核评论或失物招领)
 * 参数 :type -> 'reviews' 或 'lost-found'
 * 参数 :id   -> 对应记录的 ID
 */
app.patch('/api/admin/approve/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    
    // 根据类型映射到真实的数据库表名
    const tableMap = {
        'reviews': 'location_reviews',
        'lost-found': 'lost_and_found'
    };

    const tableName = tableMap[type];

    if (!tableName) {
        return res.status(400).json({ error: '无效的审核类型' });
    }

    try {
        const query = `
            UPDATE ${tableName} 
            SET status = 1 
            WHERE id = $1 
            RETURNING *
        `;
        
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '未找到待审核的记录' });
        }

        console.log(`✅ 审核通过 [${type}]: ID ${id}`);
        res.json({ 
            message: '审核已通过，内容现在对所有人可见', 
            data: result.rows[0] 
        });
    } catch (err) {
        console.error('❌ 审核操作失败:', err);
        res.status(500).json({ error: '服务器审核处理失败' });
    }
});

// --- 启动服务器 ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});