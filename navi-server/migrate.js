const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 数据库连接配置
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres', // 如果你创建了新数据库请修改这里
  password: '416906', 
  port: 5432,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("开始数据迁移...");

    // 1. 读取 JSON 文件 (请根据你的实际路径调整)
    const locationsData = JSON.parse(fs.readFileSync('../data.json', 'utf8'));
    const graphData = JSON.parse(fs.readFileSync('../xtu-graph.json', 'utf8'));

    // 开启事务，确保数据一致性
    await client.query('BEGIN');

    // 2. 清空旧数据（防止重复运行脚本导致数据堆积）
    await client.query('TRUNCATE TABLE location_photos, edges, locations RESTART IDENTITY CASCADE');

    // 3. 导入地点数据 (Locations)
    console.log("正在导入地点数据...");
    const locationMap = new Map(); // 用于记录旧 ID 与数据库新 ID 的映射（如果需要）

    for (const loc of locationsData) {
      const locRes = await client.query(
        `INSERT INTO locations (id, name, category, longitude, latitude, height) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [loc.id, loc.name, loc.type || '其他', loc.lng, loc.lat, loc.height || 10.0]
      );
      console.log(`已导入建筑: ${loc.name}`);
    }

    // 修改后的路网导入逻辑
    console.log("正在导入动态路网数据...");
    for (const edge of graphData.edges) {
    await client.query(
        `INSERT INTO edges (source_node, target_node, distance, flow_morning, flow_noon, flow_evening) 
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
        edge.from,         // 对应你 JSON 中的 from
        edge.to,           // 对应你 JSON 中的 to
        edge.distance,     // 物理距离
        edge.flow.morning, // 映射到 flow_morning
        edge.flow.noon,    // 映射到 flow_noon
        edge.flow.evening  // 映射到 flow_evening
        ]
    );
    }

    await client.query('COMMIT');
    console.log("✅ 迁移成功！所有数据已转入数据库。");

  } catch (e) {
    await client.query('ROLLBACK');
    console.error("❌ 迁移失败，已回滚更改:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();