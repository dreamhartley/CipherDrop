require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const SessionManager = require('./core/SessionManager');
const ChunkedUploadManager = require('./core/ChunkedUploadManager');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
// 静态文件服务 - 支持会话目录结构
app.get('/downloads/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  console.log(`Download request - Session: ${sessionId}, File: ${filename}`);

  // 安全检查：防止路径遍历攻击
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\') ||
      filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    console.log(`Invalid path detected - Session: ${sessionId}, File: ${filename}`);
    return res.status(400).json({ error: 'Invalid path' });
  }

  const fileStorageManager = SessionManager.getFileStorageManager();
  const sessionFilesDir = fileStorageManager.getSessionFilesDir(sessionId);
  const filePath = path.join(sessionFilesDir, filename);

  // 额外安全检查：确保解析后的路径仍在会话目录内
  const resolvedPath = path.resolve(filePath);
  const resolvedSessionDir = path.resolve(sessionFilesDir);
  if (!resolvedPath.startsWith(resolvedSessionDir)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // 检查文件是否存在
  if (!fsSync.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    console.log(`Session files dir: ${sessionFilesDir}`);
    // 列出目录内容进行调试
    try {
      const files = fsSync.readdirSync(sessionFilesDir);
      console.log(`Files in session directory: ${files.join(', ')}`);
    } catch (error) {
      console.log(`Cannot read session directory: ${error.message}`);
    }
    return res.status(404).json({ error: 'File not found' });
  }

  console.log(`Sending file: ${resolvedPath}`);
  // 发送文件
  res.sendFile(resolvedPath);
});

// 初始化分块上传管理器
const chunkedUploadManager = new ChunkedUploadManager(SessionManager.getFileStorageManager());

// Multer storage configuration - 动态存储配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 从请求中获取会话ID，如果没有则使用临时目录
    const sessionId = req.headers['x-session-id'] || 'temp';
    console.log(`Multer destination - Session: ${sessionId}, File: ${file.originalname}`);
    const fileStorageManager = SessionManager.getFileStorageManager();
    const sessionFilesDir = fileStorageManager.getSessionFilesDir(sessionId);
    console.log(`Target directory: ${sessionFilesDir}`);

    // 确保目录存在
    fileStorageManager.createSessionDirectories(sessionId).then(() => {
      console.log(`Directory created successfully: ${sessionFilesDir}`);
      cb(null, sessionFilesDir);
    }).catch(error => {
      console.error('Failed to create session directory:', error);
      cb(error);
    });
  },
  filename: function (req, file, cb) {
    // 加上时间戳防止重名，使用Buffer确保中文文件名正确处理
    const timestamp = Date.now();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${timestamp}-${originalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_SESSION_STORAGE_BYTES) || 1073741824,
    fieldSize: 50 * 1024 * 1024, // 50MB for field data
    fields: 10,
    files: 1
  }
});

// 添加Multer错误处理中间件
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: `File size exceeds the limit of ${Math.round((parseInt(process.env.MAX_SESSION_STORAGE_BYTES) || 1073741824) / 1024 / 1024)}MB`
      });
    }
    return res.status(400).json({
      error: 'Upload error',
      message: error.message
    });
  }
  next(error);
};

// 根路由，用于健康检查
app.get('/', (req, res) => {
  res.send('File Transfer Server is running!');
});

// API 路由
app.get('/api/code', (req, res) => {
  const result = SessionManager.createSession();

  if (result.error) {
    return res.status(429).json({
      error: 'Session limit exceeded',
      message: result.error
    });
  }

  res.json({ code: result.matchCode });
});

app.post('/api/upload', upload.single('file'), handleMulterError, async (req, res) => {
  if (!req.file) {
    return res.status(400).send({ message: 'Please upload a file.' });
  }

  const sessionId = req.headers['x-session-id'] || 'temp';
  console.log(`File upload - Session: ${sessionId}, File: ${req.file.originalname}, Size: ${req.file.size}, Path: ${req.file.path}`);

  // 检查会话存储配额
  try {
    const quotaCheck = await SessionManager.checkStorageQuota(sessionId, req.file.size);
    if (!quotaCheck.allowed) {
      // 删除已上传的文件
      await fs.unlink(req.file.path);
      return res.status(413).json({
        error: 'Storage quota exceeded',
        message: quotaCheck.message,
        currentUsage: quotaCheck.currentUsage,
        limit: quotaCheck.limit
      });
    }
  } catch (error) {
    console.error('Error checking storage quota:', error);
    // 继续处理，不阻塞上传
  }

  // 确保文件名正确处理中文
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  // 生成相对下载URL，由前端代理处理
  const downloadUrl = `/downloads/${sessionId}/${req.file.filename}`;

  const fileData = {
    name: originalName,
    size: req.file.size,
    mimeType: req.file.mimetype,
    type: req.file.mimetype, // 添加type字段作为兼容
    path: req.file.path,
    downloadUrl: downloadUrl
  };

  // 更新会话存储使用量
  try {
    await SessionManager.updateSessionStorageUsage(sessionId, req.file.size);
  } catch (error) {
    console.error('Error updating storage usage:', error);
  }

  res.send(fileData);
});

// 分块上传 API

// 初始化分块上传
app.post('/api/upload/init', async (req, res) => {
  const { fileName, fileSize, totalChunks, mimeType } = req.body;
  const sessionId = req.headers['x-session-id'] || 'temp';

  if (!fileName || !fileSize || !totalChunks || !mimeType) {
    return res.status(400).json({
      error: 'Missing required fields: fileName, fileSize, totalChunks, mimeType'
    });
  }

  // 检查会话存储配额
  try {
    const quotaCheck = await SessionManager.checkStorageQuota(sessionId, fileSize);
    if (!quotaCheck.allowed) {
      return res.status(413).json({
        error: 'Storage quota exceeded',
        message: quotaCheck.message,
        currentUsage: quotaCheck.currentUsage,
        limit: quotaCheck.limit
      });
    }
  } catch (error) {
    console.error('Error checking storage quota:', error);
    // 继续处理，不阻塞上传
  }

  try {
    const uploadId = chunkedUploadManager.initializeUpload(sessionId, fileName, fileSize, totalChunks, mimeType);
    res.json({ uploadId });
  } catch (error) {
    console.error('Failed to initialize chunked upload:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// 上传单个分块
app.post('/api/upload/chunk', upload.single('chunk'), handleMulterError, (req, res) => {
  const { uploadId, chunkIndex } = req.body;

  if (!uploadId || chunkIndex === undefined || !req.file) {
    return res.status(400).json({
      error: 'Missing required fields: uploadId, chunkIndex, chunk file'
    });
  }

  const chunkIndexNum = parseInt(chunkIndex, 10);
  if (isNaN(chunkIndexNum)) {
    return res.status(400).json({ error: 'Invalid chunk index' });
  }

  fs.readFile(req.file.path)
    .then(chunkData => {
      return chunkedUploadManager.uploadChunk(uploadId, chunkIndexNum, chunkData);
    })
    .then(success => {
      // 删除临时文件
      return fs.unlink(req.file.path).then(() => success);
    })
    .then(success => {
      if (success) {
        const progress = chunkedUploadManager.getUploadProgress(uploadId);
        res.json({ success: true, progress });
      } else {
        res.status(500).json({ error: 'Failed to save chunk' });
      }
    })
    .catch(error => {
      console.error('Failed to upload chunk:', error);
      // 尝试删除临时文件
      fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: error.message });
    });
});

// 完成分块上传
app.post('/api/upload/complete', async (req, res) => {
  const { uploadId } = req.body;

  if (!uploadId) {
    return res.status(400).json({ error: 'Missing uploadId' });
  }

  try {
    const fileInfo = await chunkedUploadManager.completeUpload(uploadId);

    // 更新会话存储使用量
    const uploadInfo = chunkedUploadManager.getUploadInfo(uploadId);
    if (uploadInfo) {
      try {
        await SessionManager.updateSessionStorageUsage(uploadInfo.sessionId, uploadInfo.fileSize);
      } catch (error) {
        console.error('Error updating storage usage:', error);
      }
    }

    res.json(fileInfo);
  } catch (error) {
    console.error('Failed to complete chunked upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取上传进度
app.get('/api/upload/progress/:uploadId', (req, res) => {
  const { uploadId } = req.params;

  const progress = chunkedUploadManager.getUploadProgress(uploadId);
  if (progress) {
    res.json(progress);
  } else {
    res.status(404).json({ error: 'Upload not found' });
  }
});

// 获取会话存储使用情况
app.get('/api/session/:sessionId/storage', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const storageUsage = await SessionManager.getFileStorageManager().getSessionStorageUsage(sessionId);
    const storageLimit = parseInt(process.env.MAX_SESSION_STORAGE_BYTES) || 1073741824; // 1GB

    // 处理无限存储的情况
    const isUnlimited = storageLimit === -1;
    const usagePercentage = isUnlimited ? 0 : Math.round((storageUsage.totalSize / storageLimit) * 100);
    const formattedLimit = isUnlimited ? '无限制' : SessionManager.getFileStorageManager().formatFileSize(storageLimit);

    res.json({
      sessionId,
      currentUsage: storageUsage.totalSize,
      limit: storageLimit,
      fileCount: storageUsage.fileCount,
      formattedUsage: storageUsage.formattedSize,
      formattedLimit: formattedLimit,
      usagePercentage: usagePercentage,
      isUnlimited: isUnlimited
    });
  } catch (error) {
    console.error('Failed to get storage usage:', error);
    res.status(500).json({ error: 'Failed to get storage usage' });
  }
});

// 获取服务器会话统计信息
app.get('/api/server/stats', (req, res) => {
  try {
    const stats = SessionManager.getSessionStats();
    res.json(stats);
  } catch (error) {
    console.error('Failed to get server stats:', error);
    res.status(500).json({ error: 'Failed to get server stats' });
  }
});

// 取消上传
app.delete('/api/upload/:uploadId', (req, res) => {
  const { uploadId } = req.params;

  chunkedUploadManager.cancelUpload(uploadId)
    .then(() => {
      res.json({ success: true });
    })
    .catch(error => {
      console.error('Failed to cancel upload:', error);
      res.status(500).json({ error: error.message });
    });
});


io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', async (data) => {
    const { code, clientToken } = data;
    if (!code) {
      return socket.emit('error', { message: '无效的请求' });
    }

    try {
      const result = await SessionManager.joinSession(code, clientToken, socket.id);

      if (result.status === 'error') {
        return socket.emit('error', { message: result.error });
      }

      socket.join(result.session.matchCode);

      socket.emit('sessionJoined', {
        clientToken: result.clientToken,
        history: result.session.history,
      });

      // 检查会话中的连接数，如果达到2，则通知双方
      const connectedClients = [...result.session.clients.values()].filter(c => c.isConnected).length;
      if (connectedClients === 2) {
        io.to(result.session.matchCode).emit('userConnected');
      }
    } catch (error) {
      console.error('Error in joinRoom:', error);
      socket.emit('error', { message: '加入会话时发生错误，请重试' });
    }
  });

  socket.on('sendMessage', (data) => {
    const { matchCode, clientToken, message } = data;
    if (!matchCode || !clientToken || !message) {
      return socket.emit('error', { message: '无效的消息请求' });
    }

    const fullMessage = SessionManager.addMessageToHistory(matchCode, clientToken, message);

    if (fullMessage) {
      io.to(matchCode).emit('receiveMessage', fullMessage);
    } else {
      socket.emit('error', { message: '消息发送失败，会话或用户无效' });
    }
  });

  socket.on('disconnect', async () => {
    try {
      const result = await SessionManager.handleDisconnect(socket.id);
      if (result && result.otherClientSocketId) {
        io.to(result.otherClientSocketId).emit('userDisconnected');
      }
      console.log('User disconnected:', socket.id);
    } catch (error) {
      console.error('Error in disconnect handler:', error);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});