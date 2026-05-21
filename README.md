# 办公设备管理系统

一个基于 Node.js + Express 构建的办公设备管理系统，提供设备管理、数据备份、文件上传等功能。

## 📋 功能特性

- **设备管理** - 新增、编辑、删除办公设备信息
- **设备分类** - 支持多种设备类型管理
- **数据备份** - 自动/手动备份数据功能
- **文件上传** - 支持设备图片上传
- **用户管理** - 简单的用户认证系统

## 🛠️ 技术栈

- **框架**: Express 4.x
- **语言**: Node.js
- **数据库**: JSON 文件存储
- **文件上传**: Multer
- **备份工具**: adm-zip
- **定时任务**: node-cron
- **前端**: HTML + CSS + JavaScript + Font Awesome

## 📦 安装运行

### 环境要求

- Node.js >= 14.0.0

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/RONGLINC93/office-equipment-management.git
cd office-equipment-management

# 安装依赖
npm install

# 启动服务
npm start
```

### 访问地址

服务启动后访问: http://localhost:9525

## 🔧 项目结构

```
office-equipment-management/
├── public/           # 前端静态文件
│   ├── assets/       # 资源文件
│   ├── app.js        # 前端逻辑
│   ├── style.css     # 样式文件
│   ├── index.html    # 主页面
│   └── login.html    # 登录页面
├── backup/           # 备份文件目录
├── uploads/          # 上传文件目录
├── server.js         # 服务端入口
├── devices.json      # 设备数据
├── device-types.json # 设备类型数据
├── users.json        # 用户数据
└── package.json      # 项目配置
```

## 📁 核心文件说明

| 文件 | 说明 |
|------|------|
| `server.js` | Express 服务端入口，包含 API 路由 |
| `devices.json` | 设备信息数据存储 |
| `device-types.json` | 设备类型定义 |
| `users.json` | 用户账户信息 |

## 🔌 API 接口

### 设备管理

- `GET /api/devices` - 获取所有设备
- `GET /api/devices/:id` - 获取单个设备
- `POST /api/devices` - 新增设备
- `PUT /api/devices/:id` - 更新设备
- `DELETE /api/devices/:id` - 删除设备

### 备份管理

- `POST /api/backup/manual` - 手动备份数据
- `GET /api/backup/list` - 获取备份列表
- `POST /api/backup/restore/:filename` - 恢复备份

## 📝 使用说明

1. 启动服务后，访问 http://localhost:9525
2. 使用默认账户登录（用户名：admin，密码：123456）
3. 在设备管理页面添加、编辑、删除设备
4. 在备份管理页面进行数据备份和恢复

## 📄 许可证

MIT License

## 📧 作者

RONGLINC93

---

**办公设备管理系统** - 高效管理您的办公设备