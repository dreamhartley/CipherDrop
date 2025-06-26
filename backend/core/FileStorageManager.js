const fs = require('fs').promises;
const path = require('path');

class FileStorageManager {
  constructor() {
    this.baseStorageDir = path.join(__dirname, '../storage');
    this.ensureBaseDirectory();
  }

  /**
   * 确保基础存储目录存在
   */
  async ensureBaseDirectory() {
    try {
      await fs.mkdir(this.baseStorageDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create base storage directory:', error);
    }
  }

  /**
   * 获取会话存储目录路径
   * @param {string} sessionId - 会话ID
   * @returns {string} - 会话存储目录路径
   */
  getSessionDir(sessionId) {
    return path.join(this.baseStorageDir, sessionId);
  }

  /**
   * 获取会话文件目录路径
   * @param {string} sessionId - 会话ID
   * @returns {string} - 会话文件目录路径
   */
  getSessionFilesDir(sessionId) {
    return path.join(this.getSessionDir(sessionId), 'files');
  }

  /**
   * 获取会话分块目录路径
   * @param {string} sessionId - 会话ID
   * @returns {string} - 会话分块目录路径
   */
  getSessionChunksDir(sessionId) {
    return path.join(this.getSessionDir(sessionId), 'chunks');
  }

  /**
   * 创建会话存储目录
   * @param {string} sessionId - 会话ID
   */
  async createSessionDirectories(sessionId) {
    try {
      const sessionDir = this.getSessionDir(sessionId);
      const filesDir = this.getSessionFilesDir(sessionId);
      const chunksDir = this.getSessionChunksDir(sessionId);

      await fs.mkdir(sessionDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });
      await fs.mkdir(chunksDir, { recursive: true });

      console.log(`Created storage directories for session: ${sessionId}`);
    } catch (error) {
      console.error(`Failed to create directories for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * 删除会话存储目录及其所有内容
   * @param {string} sessionId - 会话ID
   */
  async deleteSessionDirectories(sessionId) {
    try {
      const sessionDir = this.getSessionDir(sessionId);
      
      // 检查目录是否存在
      try {
        await fs.access(sessionDir);
      } catch (error) {
        // 目录不存在，直接返回
        return;
      }

      // 递归删除目录及其内容
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`Deleted storage directory for session: ${sessionId}`);
    } catch (error) {
      console.error(`Failed to delete directory for session ${sessionId}:`, error);
    }
  }

  /**
   * 生成文件存储路径
   * @param {string} sessionId - 会话ID
   * @param {string} originalName - 原始文件名
   * @returns {object} - 包含文件路径和下载URL的对象
   */
  generateFilePath(sessionId, originalName) {
    const timestamp = Date.now();
    const fileName = `${timestamp}-${originalName}`;
    const filePath = path.join(this.getSessionFilesDir(sessionId), fileName);

    // 使用BASE_URL环境变量生成完整的下载URL
    const baseUrl = process.env.BASE_URL || 'http://localhost';
    const downloadUrl = `${baseUrl}/downloads/${sessionId}/${fileName}`;

    return {
      filePath,
      fileName,
      downloadUrl
    };
  }

  /**
   * 生成分块存储路径
   * @param {string} sessionId - 会话ID
   * @param {string} uploadId - 上传ID
   * @returns {string} - 分块存储目录路径
   */
  generateChunkPath(sessionId, uploadId) {
    return path.join(this.getSessionChunksDir(sessionId), uploadId);
  }

  /**
   * 获取会话存储使用情况
   * @param {string} sessionId - 会话ID
   * @returns {Promise<object>} - 存储使用情况
   */
  async getSessionStorageUsage(sessionId) {
    try {
      const sessionDir = this.getSessionDir(sessionId);
      
      // 检查目录是否存在
      try {
        await fs.access(sessionDir);
      } catch (error) {
        return { totalSize: 0, fileCount: 0 };
      }

      let totalSize = 0;
      let fileCount = 0;

      const calculateDirSize = async (dirPath) => {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
              await calculateDirSize(fullPath);
            } else if (entry.isFile()) {
              const stats = await fs.stat(fullPath);
              totalSize += stats.size;
              fileCount++;
            }
          }
        } catch (error) {
          console.error(`Error calculating size for ${dirPath}:`, error);
        }
      };

      await calculateDirSize(sessionDir);

      return {
        totalSize,
        fileCount,
        formattedSize: this.formatFileSize(totalSize)
      };
    } catch (error) {
      console.error(`Failed to get storage usage for session ${sessionId}:`, error);
      return { totalSize: 0, fileCount: 0 };
    }
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} - 格式化后的文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 清理过期的会话目录
   * @param {Array<string>} activeSessions - 活跃会话ID列表
   */
  async cleanupInactiveSessions(activeSessions) {
    try {
      const entries = await fs.readdir(this.baseStorageDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !activeSessions.includes(entry.name)) {
          console.log(`Cleaning up inactive session directory: ${entry.name}`);
          await this.deleteSessionDirectories(entry.name);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup inactive sessions:', error);
    }
  }

  /**
   * 获取所有会话目录
   * @returns {Promise<Array<string>>} - 会话ID列表
   */
  async getAllSessionDirectories() {
    try {
      const entries = await fs.readdir(this.baseStorageDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      console.error('Failed to get session directories:', error);
      return [];
    }
  }
}

module.exports = FileStorageManager;
