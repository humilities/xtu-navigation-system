# xtu_navi

## 环境部署

---

### 环境要求

- node.js  18LTS+
- postgres 14+ 推荐16，需要安装postgis扩展
- postgis 3.x 随PostgreSql安装
- git

---

### 数据库初始化

- 创建数据库并启用PostGis拓展
  >参见建表sql 即根目录下的sql-exe-his.txt

- 导入初始地点数据

```powershell
    cd navi-server
    node migrate.js
```

---

### 后端服务配置

- 配置环境变量
  在navi-serve/目录下 复制.env.example为.env并填写实际配置

```txt
# 数据库连接配置模板
DB_USER=postgres
DB_PASSWORD=在此填入你的数据库密码
DB_NAME=postgres
DB_HOST=localhost
DB_PORT=5432

# 服务器运行端口
PORT=3000

# 管理员操作的秘密通行证
ADMIN_SECRET_KEY=xtu_admin_666
```

- 安装依赖并启动
  
```powershell
cd navi-server
npm install
node index.js
```

---

### 前端访问

后端同时托管前端静态文件 无需单独部署前端服务器

```txt
http://localhost:3000
```

---

### npm install安装的依赖包说明

![alt text](/report/image.png)
