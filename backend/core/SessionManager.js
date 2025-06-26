const { generateMatchCode } = require('../utils/codeGenerator');
const { v4: uuidv4 } = require('uuid');
const FileStorageManager = require('./FileStorageManager');

const MATCH_CODE_TTL = 10 * 60 * 1000; // 10 minutes
const DISCONNECT_GRACE_PERIOD = 20 * 60 * 1000; // 20 minutes
const UNUSED_SESSION_CLEANUP_PERIOD = 1 * 60 * 1000; // 1 minute for unused sessions

class SessionManager {
  constructor() {
    this.sessions = new Map(); // 使用 Map 存储会话，key 为 matchCode
    this.sessionLocks = new Set(); // 用于防止并发操作的锁
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
   * @returns {Promise<{status: string, session?: object, clientToken?: string, error?: string}>}
   */
  async joinSession(matchCode, clientToken, socketId) {
    // 检查会话锁
    if (this.sessionLocks.has(matchCode)) {
      return { status: 'error', error: '会话正在处理中，请稍后重试' };
    }

    // 加锁
    this.sessionLocks.add(matchCode);

    try {
      const session = this.getSession(matchCode);
      if (!session) {
        return { status: 'error', error: '无效的匹配码' };
      }

      // 检查是否是重连
      if (clientToken && session.clients.has(clientToken)) {
        const client = session.clients.get(clientToken);
        console.log(`Client ${clientToken} attempting to reconnect to session ${matchCode}, current connection status: ${client.isConnected}`);

        client.isConnected = true;
        client.socketId = socketId;

        // 取消清理计时器（如果存在）
        if (session.cleanupTimer) {
          clearTimeout(session.cleanupTimer);
          session.cleanupTimer = null;
          console.log(`Cancelled cleanup timer for session ${matchCode} due to client ${clientToken} reconnection`);
        } else {
          console.log(`No cleanup timer to cancel for session ${matchCode} (client ${clientToken} reconnection)`);
        }

        console.log(`Client ${clientToken} reconnected to session ${matchCode}`);
        return { status: 'reconnected', session, clientToken };
      }

      // 检查会话是否已满 - 基于已连接的客户端数量
      const connectedClients = [...session.clients.values()].filter(c => c.isConnected).length;
      console.log(`Session ${matchCode} - Connected clients: ${connectedClients}, Total clients: ${session.clients.size}`);

      if (connectedClients >= 2) {
        console.log(`Session ${matchCode} is full - rejecting new client`);
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
        console.log(`Cancelled cleanup timer for session ${matchCode} due to new client ${newClientToken} joining`);
      } else {
        console.log(`No cleanup timer to cancel for session ${matchCode} (new client ${newClientToken} joining)`);
      }

      console.log(`New client ${newClientToken} joined session ${matchCode}`);
      return { status: 'joined', session, clientToken: newClientToken };
    } finally {
      // 释放锁
      this.sessionLocks.delete(matchCode);
    }
  }

  /**
   * 处理客户端断开连接
   * @param {string} socketId
   * @returns {Promise<{session: object, otherClientSocketId: string} | null>}
   */
  async handleDisconnect(socketId) {
    for (const [matchCode, session] of this.sessions.entries()) {
      let disconnectedClientToken = null;
      for (const [clientToken, client] of session.clients.entries()) {
        if (client.socketId === socketId) {
          disconnectedClientToken = clientToken;
          break;
        }
      }

      if (disconnectedClientToken) {
        // 检查会话锁，如果被锁定则延迟处理
        if (this.sessionLocks.has(matchCode)) {
          console.log(`Session ${matchCode} is locked, delaying disconnect handling for socket ${socketId}`);
          setTimeout(() => this.handleDisconnect(socketId), 1000);
          return null;
        }

        // 加锁
        this.sessionLocks.add(matchCode);

        try {
          const client = session.clients.get(disconnectedClientToken);
          if (client) {
            client.isConnected = false;
            console.log(`Client ${disconnectedClientToken} disconnected from session ${matchCode}`);

            // 检查是否所有客户端都已断开
            const connectedClients = [...session.clients.values()].filter(c => c.isConnected);
            console.log(`Session ${matchCode} after disconnect: ${connectedClients.length} connected clients remaining`);

            if (connectedClients.length === 0) {
              console.log(`All users disconnected from session ${matchCode} - starting cleanup timer`);
              this.startSessionCleanupTimer(matchCode, session);
            } else {
              console.log(`Session ${matchCode} still has active users - cleanup timer not started`);
            }

            // 寻找另一个已连接的客户端以通知对方
            const otherClient = connectedClients.find(c => c.socketId !== socketId);
            return { session, otherClientSocketId: otherClient ? otherClient.socketId : null };
          }
        } finally {
          // 释放锁
          this.sessionLocks.delete(matchCode);
        }
        // 找到会话后跳出外层循环
        return null;
      }
    }
    return null;
  }

  /**
   * 启动会话清理计时器
   * 只有在所有用户都断开连接时才会调用此方法
   * @param {string} matchCode - 会话匹配码
   * @param {object} session - 会话对象
   */
  startSessionCleanupTimer(matchCode, session) {
    // 双重检查：确保没有用户连接
    const connectedClients = [...session.clients.values()].filter(c => c.isConnected);
    if (connectedClients.length > 0) {
      console.log(`Session ${matchCode} still has ${connectedClients.length} connected users - not starting cleanup timer`);
      return;
    }

    // 清除现有的计时器
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      console.log(`Cleared existing cleanup timer for session ${matchCode}`);
    }

    // 根据会话是否有活动决定清理时间
    const cleanupDelay = session.hasActivity ? DISCONNECT_GRACE_PERIOD : UNUSED_SESSION_CLEANUP_PERIOD;
    const delayMinutes = Math.round(cleanupDelay / 1000 / 60 * 10) / 10; // 保留1位小数

    console.log(`Starting cleanup timer for session ${matchCode}: ${delayMinutes} minutes (${session.hasActivity ? 'used' : 'unused'} session, ${session.history.length} messages, ${session.clients.size} total clients)`);

    session.cleanupTimer = setTimeout(async () => {
      // 在清理前再次检查是否有用户连接（防止竞态条件）
      const currentConnectedClients = [...session.clients.values()].filter(c => c.isConnected);
      if (currentConnectedClients.length > 0) {
        console.log(`Session ${matchCode} cleanup cancelled - users reconnected (${currentConnectedClients.length} connected)`);
        session.cleanupTimer = null;
        return;
      }

      console.log(`Executing scheduled cleanup for session ${matchCode} (${session.hasActivity ? 'used' : 'unused'} session)`);
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

    // 检查客户端是否已连接
    const client = session.clients.get(clientToken);
    if (!client || !client.isConnected) {
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
      console.log(`Cancelled cleanup timer for session ${matchCode} due to new message activity`);
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
      console.log(`Attempted to delete non-existent session: ${matchCode}`);
      return;
    }

    const connectedClients = [...session.clients.values()].filter(c => c.isConnected);
    console.log(`Deleting session ${matchCode}: hasActivity=${session.hasActivity}, messages=${session.history.length}, totalClients=${session.clients.size}, connectedClients=${connectedClients.length}`);

    // 清除清理计时器
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      console.log(`Cleared cleanup timer for session ${matchCode} during deletion`);
    }

    // 删除会话存储目录
    await this.fileStorageManager.deleteSessionDirectories(matchCode);

    // 从内存中删除会话
    this.sessions.delete(matchCode);
    console.log(`Session ${matchCode} successfully deleted (${this.sessions.size} sessions remaining)`);
  }

  /**
   * 清理过期的会话
   * 注意：这个方法作为备用清理机制，主要清理计时器可能遗漏的会话
   * 正常情况下，会话应该通过 startSessionCleanupTimer 设置的计时器来清理
   *
   * 清理规则：
   * 1. 有用户连接的会话永远不会被清理
   * 2. 未使用的会话（无消息/文件）：断开连接1分钟后清理
   * 3. 已使用的会话（有消息/文件）：断开连接20分钟后清理
   */
  async cleanupExpiredSessions() {
    const now = Date.now();
    console.log('Running periodic cleanup task...');

    const expiredSessions = [];

    // 查找过期的会话
    for (const [matchCode, session] of this.sessions.entries()) {
      const timeSinceLastActivity = now - session.lastActivityAt;
      const connectedClients = [...session.clients.values()].filter(c => c.isConnected);
      const hasConnectedUsers = connectedClients.length > 0;

      console.log(`Checking session ${matchCode}: hasConnectedUsers=${hasConnectedUsers}, hasActivity=${session.hasActivity}, timeSinceLastActivity=${Math.round(timeSinceLastActivity/1000)}s, hasCleanupTimer=${!!session.cleanupTimer}`);

      // 判断会话是否应该被清理
      let shouldCleanup = false;
      let reason = '';

      // 重要：如果有用户连接，绝对不清理
      if (hasConnectedUsers) {
        console.log(`Session ${matchCode} has ${connectedClients.length} connected users - skipping cleanup`);
        continue;
      }

      // 如果已经有清理计时器在运行，不要重复清理
      if (session.cleanupTimer) {
        console.log(`Session ${matchCode} already has cleanup timer - skipping`);
        continue;
      }

      // 只有在所有客户端都断开连接的情况下才考虑清理
      // 未使用的会话（没有消息或文件上传）快速清理
      if (!session.hasActivity && timeSinceLastActivity > UNUSED_SESSION_CLEANUP_PERIOD) {
        shouldCleanup = true;
        reason = `unused session exceeded grace period (${UNUSED_SESSION_CLEANUP_PERIOD/1000} seconds)`;
      }
      // 有活动的会话使用正常的宽限期
      else if (session.hasActivity && timeSinceLastActivity > DISCONNECT_GRACE_PERIOD) {
        shouldCleanup = true;
        reason = `active session exceeded grace period (${DISCONNECT_GRACE_PERIOD/1000/60} minutes)`;
      }

      if (shouldCleanup) {
        console.log(`Session ${matchCode} marked for cleanup: ${reason}`);
        expiredSessions.push({ matchCode, reason });
      }
    }

    // 删除过期的会话
    for (const { matchCode, reason } of expiredSessions) {
      console.log(`Cleaning up expired session ${matchCode}: ${reason}`);
      await this.deleteSession(matchCode);
    }

    if (expiredSessions.length > 0) {
      console.log(`Periodic cleanup completed: ${expiredSessions.length} sessions cleaned up`);
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
        console.log(`Cancelled cleanup timer for session ${sessionId} due to file upload activity`);
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