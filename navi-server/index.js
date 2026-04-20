const { Pool } = require('pg');
require('dotenv').config();

// 连接配置
const pool = new Pool({
  user: 'postgres',           // 默认用户名
  host: 'localhost',          // 本地主机
  database: 'postgres',       // 数据库名
  password: '416906',        // 换成你安装时设的密码
  port: 5432,                 // 默认端口
});

// 测试连接
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('连接失败了，检查一下密码吧！', err);
  } else {
    console.log('连接成功！数据库当前时间：', res.rows[0].now);
  }
  pool.end();
});

app.get('/api/map/buildings', async (req, res) => {
  // 查询所有地点及其高度，返回给前端 Mapbox 渲染 3D
  const result = await pool.query('SELECT * FROM locations');
  res.json(result.rows);
});