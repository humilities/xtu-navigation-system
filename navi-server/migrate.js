const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 数据库连接配置
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: '416906', //这里填写自己的数据库密码
    port: 5432,
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("开始数据迁移...");

        // 1. 获取绝对路径，读取并解析 JSON
        const jsonPath = path.join(__dirname, '../json/xtu_graph.json');
        const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        // 开启事务
        await client.query('BEGIN');

        // 2. 清空旧数据
        await client.query('TRUNCATE TABLE location_photos, edges, locations RESTART IDENTITY CASCADE');

        // 3. 导入地点数据 (从 rawData.nodes 读取)
        console.log("正在导入地点数据...");
        // 注意：这里要遍历 rawData.nodes 而不是 rawData 本身
        for (const loc of rawData.nodes) {
            await client.query(
                `INSERT INTO locations (id, name, category, longitude, latitude, height, description) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    loc.id, 
                    loc.name, 
                    '校园建筑',            // 默认分类
                    loc.y,                // 你的 JSON 中 y 对应经度 (112.x)
                    loc.x,                // 你的 JSON 中 x 对应纬度 (27.x)
                    loc.height || 10.0,    // 高度，默认为 10
                    loc.desc || ''        // 描述
                ]
            );
            console.log(`已导入建筑: ${loc.name}`);
        }

        // 4. 导入路网数据 (从 rawData.edges 读取)
        console.log("正在导入动态路网数据...");
        for (const edge of rawData.edges) {
            await client.query(
                `INSERT INTO edges (source_node, target_node, distance, flow_morning, flow_noon, flow_evening) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    edge.from,
                    edge.to,
                    edge.distance,
                    edge.flow.morning,
                    edge.flow.noon,
                    edge.flow.evening
                ]
            );
        }

        await client.query('COMMIT');
        console.log("✅ 迁移成功！所有数据已成功转入 PostgreSQL 数据库。");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ 迁移失败，已回滚更改:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();