const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ChunkedUploadManager {
  constructor(fileStorageManager) {
    // 存储正在进行的分块上传信息
    this.uploads = new Map();
    this.fileStorageManager = fileStorageManager;
    // 清理过期上传的定时器
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredUploads();
    }, 5 * 60 * 1000); // 每5分钟清理一次
  }

  /**
   * 初始化分块上传
   * @param {string} sessionId - 会话ID
   * @param {string} fileName - 原始文件名
   * @param {number} fileSize - 文件总大小
   * @param {number} totalChunks - 总分块数
   * @param {string} mimeType - 文件MIME类型
   * @returns {string} uploadId - 上传ID
   */
  initializeUpload(sessionId, fileName, fileSize, totalChunks, mimeType) {
    const uploadId = crypto.randomUUID();
    const timestamp = Date.now();

    const uploadInfo = {
      uploadId,
      sessionId,
      fileName,
      fileSize,
      totalChunks,
      mimeType,
      receivedChunks: new Set(),
      chunkPaths: new Map(),
      createdAt: timestamp,
      lastActivityAt: timestamp,
      tempDir: this.fileStorageManager.generateChunkPath(sessionId, uploadId)
    };

    this.uploads.set(uploadId, uploadInfo);

    // 创建临时目录
    this.ensureDirectory(uploadInfo.tempDir);

    return uploadId;
  }

  /**
   * 上传单个分块
   * @param {string} uploadId - 上传ID
   * @param {number} chunkIndex - 分块索引
   * @param {Buffer} chunkData - 分块数据
   * @returns {boolean} success - 是否成功
   */
  async uploadChunk(uploadId, chunkIndex, chunkData) {
    const uploadInfo = this.uploads.get(uploadId);
    if (!uploadInfo) {
      throw new Error('Upload not found');
    }

    if (chunkIndex < 0 || chunkIndex >= uploadInfo.totalChunks) {
      throw new Error('Invalid chunk index');
    }

    if (uploadInfo.receivedChunks.has(chunkIndex)) {
      // 分块已存在，跳过
      return true;
    }

    const chunkPath = path.join(uploadInfo.tempDir, `chunk_${chunkIndex}`);
    
    try {
      await fs.writeFile(chunkPath, chunkData);
      uploadInfo.receivedChunks.add(chunkIndex);
      uploadInfo.chunkPaths.set(chunkIndex, chunkPath);
      uploadInfo.lastActivityAt = Date.now();
      
      return true;
    } catch (error) {
      console.error('Failed to save chunk:', error);
      return false;
    }
  }

  /**
   * 完成分块上传，合并所有分块
   * @param {string} uploadId - 上传ID
   * @returns {object} fileInfo - 合并后的文件信息
   */
  async completeUpload(uploadId) {
    const uploadInfo = this.uploads.get(uploadId);
    if (!uploadInfo) {
      throw new Error('Upload not found');
    }

    // 检查是否所有分块都已接收
    if (uploadInfo.receivedChunks.size !== uploadInfo.totalChunks) {
      throw new Error(`Missing chunks. Expected ${uploadInfo.totalChunks}, got ${uploadInfo.receivedChunks.size}`);
    }

    // 生成最终文件路径
    const { filePath: finalPath, fileName: finalFileName, downloadUrl } =
      this.fileStorageManager.generateFilePath(uploadInfo.sessionId, uploadInfo.fileName);

    try {
      // 合并所有分块
      const writeStream = require('fs').createWriteStream(finalPath);
      
      for (let i = 0; i < uploadInfo.totalChunks; i++) {
        const chunkPath = uploadInfo.chunkPaths.get(i);
        if (!chunkPath) {
          throw new Error(`Missing chunk ${i}`);
        }
        
        const chunkData = await fs.readFile(chunkPath);
        writeStream.write(chunkData);
      }
      
      writeStream.end();
      
      // 等待写入完成
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      // 验证文件大小
      const stats = await fs.stat(finalPath);
      if (stats.size !== uploadInfo.fileSize) {
        await fs.unlink(finalPath);
        throw new Error(`File size mismatch. Expected ${uploadInfo.fileSize}, got ${stats.size}`);
      }

      // 清理临时文件
      await this.cleanupUpload(uploadId);

      // 返回文件信息
      const fileInfo = {
        name: uploadInfo.fileName,
        size: uploadInfo.fileSize,
        mimeType: uploadInfo.mimeType,
        type: uploadInfo.mimeType,
        path: finalPath,
        downloadUrl: downloadUrl
      };

      return fileInfo;
    } catch (error) {
      // 清理临时文件和最终文件
      await this.cleanupUpload(uploadId);
      try {
        await fs.unlink(finalPath);
      } catch (e) {
        // 忽略删除错误
      }
      throw error;
    }
  }

  /**
   * 获取上传进度
   * @param {string} uploadId - 上传ID
   * @returns {object} progress - 上传进度信息
   */
  getUploadProgress(uploadId) {
    const uploadInfo = this.uploads.get(uploadId);
    if (!uploadInfo) {
      return null;
    }

    return {
      uploadId,
      totalChunks: uploadInfo.totalChunks,
      receivedChunks: uploadInfo.receivedChunks.size,
      progress: Math.round((uploadInfo.receivedChunks.size / uploadInfo.totalChunks) * 100),
      missingChunks: Array.from({ length: uploadInfo.totalChunks }, (_, i) => i)
        .filter(i => !uploadInfo.receivedChunks.has(i))
    };
  }

  /**
   * 获取上传信息
   * @param {string} uploadId - 上传ID
   * @returns {object|null} uploadInfo - 上传信息
   */
  getUploadInfo(uploadId) {
    return this.uploads.get(uploadId) || null;
  }

  /**
   * 取消上传
   * @param {string} uploadId - 上传ID
   */
  async cancelUpload(uploadId) {
    await this.cleanupUpload(uploadId);
  }

  /**
   * 清理单个上传的临时文件
   * @param {string} uploadId - 上传ID
   */
  async cleanupUpload(uploadId) {
    const uploadInfo = this.uploads.get(uploadId);
    if (!uploadInfo) {
      return;
    }

    try {
      // 删除临时目录及其内容
      await fs.rmdir(uploadInfo.tempDir, { recursive: true });
    } catch (error) {
      console.error('Failed to cleanup upload:', error);
    }

    this.uploads.delete(uploadId);
  }

  /**
   * 清理过期的上传
   */
  async cleanupExpiredUploads() {
    const now = Date.now();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时

    for (const [uploadId, uploadInfo] of this.uploads.entries()) {
      if (now - uploadInfo.lastActivityAt > expireTime) {
        console.log(`Cleaning up expired upload: ${uploadId}`);
        await this.cleanupUpload(uploadId);
      }
    }
  }

  /**
   * 确保目录存在
   * @param {string} dirPath - 目录路径
   */
  async ensureDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * 销毁管理器
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = ChunkedUploadManager;
