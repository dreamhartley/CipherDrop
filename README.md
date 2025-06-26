# CipherDrop | 端到端加密传输

一个轻量级的端到端加密文件传输应用，支持实时文件分享、大文件分块传输和媒体预览功能。

## ✨ 主要特性

### 🔒 安全性
- **端到端加密**：使用 AES-GCM 256位加密，确保文件传输安全
- **会话隔离**：每个传输会话独立，互不干扰
- **安全URL**：复杂的会话令牌，防止直接访问
- **自动过期**：会话和文件自动清理，保护隐私

### 📁 文件传输
- **无文件类型限制**：支持所有文件格式
- **大文件支持**：自动分块传输，支持超大文件
- **实时进度**：上传下载进度实时显示
- **断点续传**：分块上传失败自动重试

### 🎵 媒体预览
- **图片预览**：支持常见图片格式的即时预览
- **视频播放**：内置视频播放器，支持多种视频格式
- **音频播放**：支持音频文件在线播放
- **自动预览**：小文件自动生成预览

### 💾 存储管理
- **容量限制**：每个会话默认1GB存储空间（可配置为无限制）
- **实时监控**：存储使用情况实时显示
- **自动清理**：过期会话数据自动删除
- **按会话组织**：文件按会话ID分类存储在独立目录
- **隔离存储**：每个会话拥有独立的files/和chunks/目录
- **灵活配置**：支持设置为-1表示无限存储

### ⚙️ 会话管理
- **并发控制**：默认最大5个活跃会话（可配置）
- **智能限流**：超出限制时友好提示用户
- **资源保护**：防止服务器资源过度消耗
- **弹性配置**：支持设置为-1表示无限会话

### 🌐 用户体验
- **简单易用**：6位匹配码快速连接
- **页面刷新支持**：30分钟cookie会话保持
- **响应式设计**：支持各种设备屏幕
- **实时通信**：WebSocket实现即时消息传递

## 🚀 快速开始

### 环境要求
- Node.js 16.0+
- npm 或 yarn

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/dreamhartley/CipherDrop.git
cd CipherDrop
```

2. **安装后端依赖**
```bash
cd backend
npm install
```

3. **安装前端依赖**
```bash
cd ../frontend
npm install
```

4. **配置环境变量**
```bash
cd ../backend
cp .env.example .env
# 编辑 .env 文件，配置必要的环境变量
```

5. **启动应用**

启动后端服务：
```bash
cd backend
npm start
```

启动前端开发服务器：
```bash
cd frontend
npm run dev
```

6. **访问应用**
打开浏览器访问：`http://localhost:5173`

## 📖 使用说明

### 创建传输会话
1. 访问主页
2. 点击"创建"按钮
3. 系统生成6位匹配码
4. 分享匹配码给接收方

### 加入传输会话
1. 访问主页
2. 输入6位匹配码
3. 点击"加入传输"按钮
4. 进入共享传输空间

### 文件传输
1. 拖拽文件到传输区域，或点击上传按钮
2. 文件自动加密并上传
3. 对方可实时看到文件并下载
4. 支持图片、视频、音频预览

### 会话管理
- **存储监控**：页面顶部显示当前存储使用情况
- **会话过期**：无活动20分钟后自动过期
- **手动离开**：点击"离开会话"按钮退出

## 🛠️ 技术架构

### 前端技术栈
- **Vue 3**：现代化前端框架
- **Element Plus**：UI组件库
- **Vue Router**：路由管理
- **WebSocket**：实时通信
- **Web Crypto API**：客户端加密

### 后端技术栈
- **Node.js**：服务器运行环境
- **Express**：Web框架
- **Socket.IO**：WebSocket通信
- **Multer**：文件上传处理
- **fs/promises**：文件系统操作

### 安全特性
- **AES-GCM加密**：256位密钥长度
- **随机密钥生成**：每个文件独立密钥
- **安全会话管理**：令牌验证和过期控制
- **CSRF保护**：SameSite cookie设置

## 📁 项目结构

```
CipherDrop/
├── backend/                 # 后端服务
│   ├── core/               # 核心模块
│   │   ├── SessionManager.js      # 会话管理
│   │   ├── FileStorageManager.js  # 文件存储管理
│   │   └── ChunkedUploadManager.js # 分块上传管理
│   ├── storage/            # 动态文件存储目录
│   │   └── [sessionId]/    # 按会话ID组织的文件目录
│   ├── .env               # 环境配置
│   ├── index.js           # 服务器入口
│   └── package.json       # 依赖配置
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── views/         # 页面组件
│   │   ├── services/      # 服务模块
│   │   ├── utils/         # 工具函数
│   │   ├── config/        # 配置文件
│   │   └── router/        # 路由配置
│   ├── index.html         # HTML模板
│   └── package.json       # 依赖配置
└── README.md              # 项目说明
```

## ⚙️ 配置说明

### 环境变量 (.env)
```env
PORT=3001                           # 服务器端口
MAX_SESSION_STORAGE_BYTES=1073741824 # 会话存储限制(1GB，设置为-1表示无限存储)
MAX_ACTIVE_SESSIONS=5               # 最大活跃会话数量(设置为-1表示无限制)
```

### 上传配置
- **单文件大小限制**：500MB
- **分块上传阈值**：80MB
- **分块大小**：50MB
- **并发上传数**：3个分块
- **会话存储限制**：1GB（可配置为无限制）

## 🔧 开发说明

### 开发模式
```bash
# 后端开发模式（自动重启）
cd backend && npm run dev

# 前端开发模式（热更新）
cd frontend && npm run dev
```

### 构建生产版本
```bash
# 构建前端
cd frontend && npm run build

# 生产环境运行
cd backend && npm start
```

### API接口
- `GET /api/code` - 生成匹配码
- `POST /api/upload` - 普通文件上传
- `POST /api/upload/init` - 初始化分块上传
- `POST /api/upload/chunk` - 上传文件分块
- `POST /api/upload/complete` - 完成分块上传
- `GET /api/session/:sessionId/storage` - 获取存储使用情况
- `GET /api/server/stats` - 获取服务器会话统计信息
- `GET /download/:filename` - 下载文件

### WebSocket事件
- `joinRoom` - 加入会话
- `sendMessage` - 发送消息
- `sessionJoined` - 会话加入成功
- `receiveMessage` - 接收消息
- `userConnected` - 用户连接
- `userDisconnected` - 用户断开

## 🚀 部署指南

### Docker部署（推荐）

#### 快速启动
```bash
# 使用Docker Compose一键启动
docker-compose up -d

# 查看服务状态
docker-compose ps

# 访问应用：http://localhost
```

#### 手动构建
```bash
# 构建所有镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 生产环境建议
- 使用HTTPS协议确保安全
- 配置反向代理（Nginx）
- 设置文件存储清理定时任务
- 监控服务器资源使用情况
- 定期备份重要配置文件

## 📝 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 📞 支持

如有问题或建议，请通过以下方式联系：
- 提交 GitHub Issue
- 发送邮件至项目维护者

---

**注意**：本应用仅用于合法的文件传输用途，请遵守相关法律法规。
