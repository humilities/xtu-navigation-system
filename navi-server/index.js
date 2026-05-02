const { Pool } = require('pg');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// --- 中间件配置 ---
app.use(cors()); 
app.use(express.json());
// 托管静态资源，确保 navi-server 目录下有 uploads 文件夹
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 数据库连接配置 ---
// 建议：如果有了 .env 文件，可以使用 process.env.DB_PASSWORD 等替代硬编码
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres', 
  password: '416906', 
  port: 5432,
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
        -- 使用 COALESCE 处理 null，确保前端拿到的是空数组而不是 null
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

// --- 启动服务器 ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});