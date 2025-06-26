import api from './api.js';
import streamCrypto from './streamCrypto.js';
import { uploadConfig } from '../config/upload.js';
import sodium from 'libsodium-wrappers';

/**
 * 加密分块上传工具类
 * 结合流式加密和分块上传，避免内存问题
 */
export class EncryptedChunkedUploader {
  constructor(options = {}) {
    // 使用配置文件的默认值
    this.chunkSize = options.chunkSize || uploadConfig.chunked.chunkSize;
    this.maxConcurrentUploads = options.maxConcurrentUploads || uploadConfig.chunked.maxConcurrentUploads;
    this.retryAttempts = options.retryAttempts || uploadConfig.chunked.retryAttempts;
    this.retryDelay = options.retryDelay || uploadConfig.chunked.retryDelay;
    this.sessionId = options.sessionId;
    
    // 状态管理
    this.uploadId = null;
    this.file = null;
    this.chunks = [];
    this.uploadedChunks = new Set();
    this.failedChunks = new Set();
    this.isUploading = false;
    this.isPaused = false;
    this.isCancelled = false;
    
    // 加密相关
    this.key = null;
    this.nonce = null;
    
    // 回调函数
    this.onProgress = options.onProgress || (() => {});
    this.onChunkProgress = options.onChunkProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * 检查文件是否需要加密分块上传
   * @param {File} file - 文件对象
   * @returns {boolean} - 是否需要加密分块上传
   */
  static shouldUseEncryptedChunkedUpload(file) {
    return file.size > uploadConfig.chunked.threshold;
  }

  /**
   * 开始加密分块上传
   * @param {File} file - 要上传的文件
   * @returns {Promise<object>} - 上传结果
   */
  async upload(file) {
    if (this.isUploading) {
      throw new Error('Upload already in progress');
    }

    this.file = file;
    this.isUploading = true;
    this.isCancelled = false;
    this.isPaused = false;

    try {
      // 生成加密密钥和nonce
      await sodium.ready; // 确保sodium已初始化
      this.key = await streamCrypto.generateKey();
      this.nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      
      // 分割文件
      this.chunks = this.splitFile(file);
      
      // 计算加密后的总大小（估算）
      const estimatedEncryptedSize = this.estimateEncryptedSize(file.size);
      
      // 初始化上传
      const { uploadId } = await api.chunkedUpload.init(
        file.name,
        estimatedEncryptedSize,
        this.chunks.length,
        file.type,
        this.sessionId
      );
      
      this.uploadId = uploadId;

      // 开始加密并上传分块
      const result = await this.encryptAndUploadChunks();
      
      // 完成上传
      const fileInfo = await api.chunkedUpload.complete(uploadId);
      
      // 添加加密信息到文件信息
      const encryptionKey = await streamCrypto.exportKey(this.key);
      const encryptionNonce = await streamCrypto.exportKey(this.nonce);
      
      const finalFileInfo = {
        ...fileInfo,
        key: encryptionKey,
        nonce: encryptionNonce,
        encrypted: true
      };
      
      this.onComplete(finalFileInfo);
      return finalFileInfo;
      
    } catch (error) {
      this.onError(error);
      throw error;
    } finally {
      this.isUploading = false;
    }
  }

  /**
   * 分割文件为分块
   * @param {File} file - 文件对象
   * @returns {Array} - 分块数组
   */
  splitFile(file) {
    const chunks = [];
    let start = 0;
    let index = 0;

    while (start < file.size) {
      const end = Math.min(start + this.chunkSize, file.size);
      chunks.push({
        index,
        start,
        end,
        size: end - start,
        data: null, // 数据将在上传时读取
        uploaded: false
      });
      start = end;
      index++;
    }

    return chunks;
  }

  /**
   * 估算加密后的文件大小
   * @param {number} originalSize - 原始文件大小
   * @returns {number} - 估算的加密后大小
   */
  estimateEncryptedSize(originalSize) {
    // 每个分块会增加：4字节大小信息 + libsodium overhead (约16字节)
    const chunksCount = Math.ceil(originalSize / this.chunkSize);
    const overhead = chunksCount * (4 + 16); // 估算overhead
    return originalSize + overhead;
  }

  /**
   * 加密并上传所有分块
   * @returns {Promise<void>}
   */
  async encryptAndUploadChunks() {
    const pendingChunks = this.chunks.filter(chunk => !this.uploadedChunks.has(chunk.index));
    
    // 使用并发控制上传分块
    const uploadPromises = [];
    let currentIndex = 0;

    const uploadNext = async () => {
      while (currentIndex < pendingChunks.length && !this.isCancelled && !this.isPaused) {
        const chunk = pendingChunks[currentIndex++];
        
        if (this.uploadedChunks.has(chunk.index)) {
          continue;
        }

        try {
          await this.encryptAndUploadSingleChunk(chunk);
        } catch (error) {
          console.error(`Failed to upload chunk ${chunk.index}:`, error);
          this.failedChunks.add(chunk.index);
        }
      }
    };

    // 启动并发上传
    for (let i = 0; i < this.maxConcurrentUploads; i++) {
      uploadPromises.push(uploadNext());
    }

    await Promise.all(uploadPromises);

    // 检查是否有失败的分块
    if (this.failedChunks.size > 0) {
      throw new Error(`Failed to upload ${this.failedChunks.size} chunks`);
    }
  }

  /**
   * 加密并上传单个分块
   * @param {object} chunk - 分块对象
   * @returns {Promise<void>}
   */
  async encryptAndUploadSingleChunk(chunk) {
    if (this.uploadedChunks.has(chunk.index)) {
      return;
    }

    // 读取分块数据
    const chunkBlob = this.file.slice(chunk.start, chunk.end);
    const chunkData = new Uint8Array(await chunkBlob.arrayBuffer());

    // 加密分块
    const encryptedChunk = await streamCrypto.encryptChunk(
      chunkData, 
      this.key, 
      this.nonce, 
      chunk.index
    );

    // 创建加密后的分块文件
    const encryptedBlob = new Blob([encryptedChunk]);

    const onChunkProgress = (progressEvent) => {
      const chunkProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      this.onChunkProgress(chunk.index, chunkProgress);
      
      // 计算总体进度
      this.updateOverallProgress();
    };

    const result = await api.chunkedUpload.uploadChunk(
      this.uploadId,
      chunk.index,
      encryptedBlob,
      onChunkProgress
    );

    if (result.success) {
      this.uploadedChunks.add(chunk.index);
      this.failedChunks.delete(chunk.index);
      chunk.uploaded = true;
      
      // 更新总体进度
      this.updateOverallProgress();
    } else {
      throw new Error(`Failed to upload chunk ${chunk.index}`);
    }
  }

  /**
   * 更新总体进度
   */
  updateOverallProgress() {
    const progress = this.chunks.length > 0 ? 
      Math.round((this.uploadedChunks.size / this.chunks.length) * 100) : 0;
    
    this.onProgress({
      loaded: this.uploadedChunks.size,
      total: this.chunks.length,
      percentage: progress
    });
  }

  /**
   * 取消上传
   */
  async cancel() {
    this.isCancelled = true;
    this.isUploading = false;
    
    if (this.uploadId) {
      try {
        await api.chunkedUpload.cancel(this.uploadId);
      } catch (error) {
        console.error('Failed to cancel upload:', error);
      }
    }
  }

  /**
   * 获取上传状态
   * @returns {object} - 上传状态信息
   */
  getStatus() {
    return {
      isUploading: this.isUploading,
      isPaused: this.isPaused,
      isCancelled: this.isCancelled,
      uploadedChunks: this.uploadedChunks.size,
      totalChunks: this.chunks.length,
      failedChunks: this.failedChunks.size,
      progress: this.chunks.length > 0 ? Math.round((this.uploadedChunks.size / this.chunks.length) * 100) : 0
    };
  }
}

export default EncryptedChunkedUploader;
