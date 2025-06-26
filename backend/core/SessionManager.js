const { generateMatchCode } = require('../utils/codeGenerator');
const { v4: uuidv4 } = require('uuid');
const FileStorageManager = require('./FileStorageManager');

const MATCH_CODE_TTL = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const DISCONNECT_GRACE_PERIOD = 20 * 60 * 1000; // 20 minutes
const UNUSED_SESSION_CLEANUP_PERIOD = 1 * 60 * 1000; // 1 minute for unused sessions

class SessionManager {
  constructor() {
    this.sessions = new Map(); // 使用 Map 存储会话，key 为 matchCode
    this.fileStorageManager = new FileStorageManager();
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), 30 * 1000); // 每30秒检查一次
    console.log("SessionManager initialized.");
  }

  /**
   * 创建一个新的会话并返回匹配码
   * @returns {{matchCode: string} | {error: string}}
   */
  createSession() {
    // 检查最大会话数量限制
    const maxSessions = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 5;

    // 如果设置为-1，表示无限制
    if (maxSessions !== -1 && this.sessions.size >= maxSessions) {
      return {
        error: `服务器繁忙，当前活跃会话数已达上限 (${maxSessions})，请稍后再试`
      };
    }

    let matchCode;
    do {
      matchCode = generateMatchCode();
    } while (this.sessions.has(matchCode));

    const session = {
      matchCode,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      totalStorageUsed: 0,
      clients: new Map(), // 使用 Map 存储客户端，key 为 clientToken
      history: [],
      cleanupTimer: null, // 用于断线宽限期的计时器
      hasActivity: false, // 跟踪会话是否有实际活动（消息或文件上传）
    };

    this.sessions.set(matchCode, session);

    // 创建会话存储目录
    this.fileStorageManager.createSessionDirectories(matchCode).catch(error => {
      console.error(`Failed to create storage for session ${matchCode}:`, error);
    });

    console.log(`Session created with match code: ${matchCode} (${this.sessions.size}/${maxSessions === -1 ? '∞' : maxSessions})`);
    return { matchCode };
  }

  /**
   * 根据匹配码获取会话
   * @param {string} matchCode
   * @returns {object | undefined}
   */
  getSession(matchCode) {
    return this.sessions.get(matchCode);
  }

  /**
   * 处理客户端加入会话的逻辑
   * @param {string} matchCode
   * @param {string} clientToken - 可选的，用于重连
   * @param {string} socketId
   * @returns {{status: string, session?: object, clientToken?: string, error?: string}}
   */
  joinSession(matchCode, clientToken, socketId) {
    const session = this.getSession(matchCode);
    if (!session) {
      return { status: 'error', error: '无效的匹配码' };
    }

    // 检查是否是重连
    if (clientToken && session.clients.has(clientToken)) {
      const client = session.clients.get(clientToken);
      client.isConnected = true;
      client.socketId = socketId;

      // 取消清理计时器（如果存在）
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
        console.log(`Cancelled cleanup timer for session ${matchCode} due to reconnection`);
      }

      console.log(`Client ${clientToken} reconnected to session ${matchCode}`);
      return { status: 'reconnected', session, clientToken };
    }

    // 检查会话是否已满
    if (session.clients.size >= 2) {
      return { status: 'error', error: '会话已满员' };
    }

    // 新客户端加入
    const newClientToken = uuidv4();
    session.clients.set(newClientToken, {
      socketId,
      isConnected: true,
    });

    // 取消清理计时器（如果存在）
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
      console.log(`Cancelled cleanup timer for session ${matchCode} due to new client joining`);
    }

    console.log(`New client ${newClientToken} joined session ${matchCode}`);
    return { status: 'joined', session, clientToken: newClientToken };
  }

  /**
   * 处理客户端断开连接
   * @param {string} socketId
   * @returns {{session: object, otherClientSocketId: string} | null}
   */
  handleDisconnect(socketId) {
    for (const [matchCode, session] of this.sessions.entries()) {
      for (const [clientToken, client] of session.clients.entries()) {
        if (client.socketId === socketId) {
          client.isConnected = false;
          console.log(`Client ${clientToken} disconnected from session ${matchCode}`);
          
          // 检查是否所有客户端都已断开
          const allDisconnected = ![...session.clients.values()].some(c => c.isConnected);
          if (allDisconnected) {
            // 启动会话销毁计时器
            this.startSessionCleanupTimer(matchCode, session);
          }

          // 寻找另一个客户端以通知对方
          let otherClientSocketId = null;
          for (const [otherToken, otherClient] of session.clients.entries()) {
            if (clientToken !== otherToken && otherClient.isConnected) {
              otherClientSocketId = otherClient.socketId;
              break;
            }
          }
          
          return { session, otherClientSocketId };
        }
      }
    }
    return null;
  }

  /**
   * 启动会话清理计时器
   * @param {string} matchCode - 会话匹配码
   * @param {object} session - 会话对象
   */
  startSessionCleanupTimer(matchCode, session) {
    // 清除现有的计时器
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    // 根据会话是否有活动决定清理时间
    const cleanupDelay = session.hasActivity ? DISCONNECT_GRACE_PERIOD : UNUSED_SESSION_CLEANUP_PERIOD;

    console.log(`Starting cleanup timer for session ${matchCode}: ${cleanupDelay / 1000}s (${session.hasActivity ? 'active' : 'unused'} session)`);

    session.cleanupTimer = setTimeout(async () => {
      console.log(`Cleaning up ${session.hasActivity ? 'active' : 'unused'} session: ${matchCode}`);
      await this.deleteSession(matchCode);
    }, cleanupDelay);
  }

  /**
   * 将消息添加到会话历史记录
   * @param {string} matchCode
   * @param {string} clientToken
   * @param {object} message
   * @returns {object | null} The full message object or null if session not found
   */
  addMessageToHistory(matchCode, clientToken, message) {
    const session = this.getSession(matchCode);
    if (!session || !session.clients.has(clientToken)) {
      return null;
    }

    const fullMessage = {
      ...message,
      sender: clientToken,
      timestamp: Date.now(),
    };

    session.history.push(fullMessage);
    session.lastActivityAt = Date.now(); // 更新会话活跃时间
    session.hasActivity = true; // 标记会话有活动

    // 清除快速清理计时器（如果存在）
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }

    return fullMessage;
  }

  /**
   * 删除会话
   * @param {string} matchCode - 会话匹配码
   */
  async deleteSession(matchCode) {
    const session = this.sessions.get(matchCode);
    if (!session) {
      return;
    }

    // 清除清理计时器
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    // 删除会话存储目录
    await this.fileStorageManager.deleteSessionDirectories(matchCode);

    // 从内存中删除会话
    this.sessions.delete(matchCode);
    console.log(`Session ${matchCode} deleted`);
  }

  /**
   * 清理过期的会话
   */
  async cleanupExpiredSessions() {
    const now = Date.now();
    console.log('Running cleanup task...');

    const expiredSessions = [];

    // 查找过期的会话
    for (const [matchCode, session] of this.sessions.entries()) {
      const timeSinceLastActivity = now - session.lastActivityAt;
      const allDisconnected = ![...session.clients.values()].some(c => c.isConnected);

      // 判断会话是否应该被清理
      let shouldCleanup = false;

      // 会话超过最大生存时间
      if (timeSinceLastActivity > SESSION_TTL) {
        shouldCleanup = true;
      }
      // 所有客户端都断开连接的情况
      else if (allDisconnected) {
        // 未使用的会话（没有消息或文件上传）快速清理
        if (!session.hasActivity && timeSinceLastActivity > UNUSED_SESSION_CLEANUP_PERIOD) {
          shouldCleanup = true;
        }
        // 有活动的会话使用正常的宽限期
        else if (session.hasActivity && timeSinceLastActivity > DISCONNECT_GRACE_PERIOD) {
          shouldCleanup = true;
        }
      }

      if (shouldCleanup) {
        expiredSessions.push(matchCode);
      }
    }

    // 删除过期的会话
    for (const matchCode of expiredSessions) {
      console.log(`Cleaning up expired session: ${matchCode}`);
      await this.deleteSession(matchCode);
    }

    // 清理孤立的存储目录
    const activeSessions = Array.from(this.sessions.keys());
    await this.fileStorageManager.cleanupInactiveSessions(activeSessions);
  }

  /**
   * 检查会话存储配额
   * @param {string} sessionId - 会话ID
   * @param {number} additionalSize - 要添加的文件大小
   * @returns {Promise<{allowed: boolean, currentUsage: number, limit: number, message?: string}>}
   */
  async checkStorageQuota(sessionId, additionalSize) {
    try {
      const storageLimit = parseInt(process.env.MAX_SESSION_STORAGE_BYTES) || 1073741824; // 1GB

      // 如果设置为-1，表示无限存储
      if (storageLimit === -1) {
        return {
          allowed: true,
          currentUsage: 0,
          limit: -1
        };
      }

      const currentUsage = await this.fileStorageManager.getSessionStorageUsage(sessionId);
      const newTotalSize = currentUsage.totalSize + additionalSize;

      if (newTotalSize > storageLimit) {
        return {
          allowed: false,
          currentUsage: currentUsage.totalSize,
          limit: storageLimit,
          message: `存储空间不足。当前使用: ${currentUsage.formattedSize}, 限制: ${this.fileStorageManager.formatFileSize(storageLimit)}`
        };
      }

      return {
        allowed: true,
        currentUsage: currentUsage.totalSize,
        limit: storageLimit
      };
    } catch (error) {
      console.error('Failed to check storage quota:', error);
      // 出错时允许上传，避免阻塞正常功能
      return {
        allowed: true,
        currentUsage: 0,
        limit: parseInt(process.env.MAX_SESSION_STORAGE_BYTES) || 1073741824
      };
    }
  }

  /**
   * 更新会话存储使用量
   * @param {string} sessionId - 会话ID
   * @param {number} additionalSize - 新增的文件大小
   */
  async updateSessionStorageUsage(sessionId, additionalSize) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.totalStorageUsed += additionalSize;
      session.lastActivityAt = Date.now();
      session.hasActivity = true; // 标记会话有活动

      // 清除快速清理计时器（如果存在）
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
      }
    }
  }

  /**
   * 获取会话统计信息
   * @returns {object} 会话统计信息
   */
  getSessionStats() {
    const maxSessions = parseInt(process.env.MAX_ACTIVE_SESSIONS) || 5;
    const activeSessions = this.sessions.size;

    return {
      activeSessions,
      maxSessions,
      isUnlimited: maxSessions === -1,
      availableSlots: maxSessions === -1 ? -1 : Math.max(0, maxSessions - activeSessions),
      usagePercentage: maxSessions === -1 ? 0 : Math.round((activeSessions / maxSessions) * 100)
    };
  }

  /**
   * 获取文件存储管理器
   * @returns {FileStorageManager}
   */
  getFileStorageManager() {
    return this.fileStorageManager;
  }
}

// 导出一个单例，确保整个应用中只有一个 SessionManager 实例
const instance = new SessionManager();
module.exports = instance;