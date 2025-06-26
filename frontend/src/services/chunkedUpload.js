import api from './api.js';
import { uploadConfig } from '../config/upload.js';

/**
 * 分块上传工具类
 */
export class ChunkedUploader {
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
    
    // 回调函数
    this.onProgress = options.onProgress || (() => {});
    this.onChunkProgress = options.onChunkProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * 检查文件是否需要分块上传
   * @param {File} file - 文件对象
   * @returns {boolean} - 是否需要分块上传
   */
  static shouldUseChunkedUpload(file) {
    return file.size > uploadConfig.chunked.threshold;
  }

  /**
   * 开始上传文件
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
      // 分割文件
      this.chunks = this.splitFile(file);
      
      // 初始化上传
      const { uploadId } = await api.chunkedUpload.init(
        file.name,
        file.size,
        this.chunks.length,
        file.type,
        this.sessionId
      );
      
      this.uploadId = uploadId;

      // 开始上传分块
      const result = await this.uploadChunks();
      
      // 完成上传
      const fileInfo = await api.chunkedUpload.complete(uploadId);
      
      this.onComplete(fileInfo);
      return fileInfo;
      
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
    const totalChunks = Math.ceil(file.size / this.chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      chunks.push({
        index: i,
        data: chunk,
        size: chunk.size,
        uploaded: false,
        retryCount: 0
      });
    }
    
    return chunks;
  }

  /**
   * 上传所有分块
   * @returns {Promise<void>}
   */
  async uploadChunks() {
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
          await this.uploadSingleChunk(chunk);
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

    // 检查是否有失败的分块需要重试
    if (this.failedChunks.size > 0 && !this.isCancelled) {
      await this.retryFailedChunks();
    }

    // 检查是否所有分块都上传成功
    if (this.uploadedChunks.size !== this.chunks.length) {
      throw new Error(`Upload incomplete. ${this.uploadedChunks.size}/${this.chunks.length} chunks uploaded.`);
    }
  }

  /**
   * 上传单个分块
   * @param {object} chunk - 分块对象
   * @returns {Promise<void>}
   */
  async uploadSingleChunk(chunk) {
    if (this.uploadedChunks.has(chunk.index)) {
      return;
    }

    const onChunkProgress = (progressEvent) => {
      const chunkProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      this.onChunkProgress(chunk.index, chunkProgress);
      
      // 计算总体进度
      this.updateOverallProgress();
    };

    const result = await api.chunkedUpload.uploadChunk(
      this.uploadId,
      chunk.index,
      chunk.data,
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
   * 重试失败的分块
   * @returns {Promise<void>}
   */
  async retryFailedChunks() {
    const failedChunkIndexes = Array.from(this.failedChunks);
    
    for (const chunkIndex of failedChunkIndexes) {
      const chunk = this.chunks[chunkIndex];
      
      if (chunk.retryCount >= this.retryAttempts) {
        continue;
      }

      chunk.retryCount++;
      
      try {
        // 等待重试延迟
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * chunk.retryCount));
        
        await this.uploadSingleChunk(chunk);
      } catch (error) {
        console.error(`Retry ${chunk.retryCount} failed for chunk ${chunkIndex}:`, error);
        
        if (chunk.retryCount >= this.retryAttempts) {
          throw new Error(`Chunk ${chunkIndex} failed after ${this.retryAttempts} retries`);
        }
      }
    }
  }

  /**
   * 更新总体进度
   */
  updateOverallProgress() {
    const totalChunks = this.chunks.length;
    const uploadedChunks = this.uploadedChunks.size;
    const progress = Math.round((uploadedChunks / totalChunks) * 100);
    
    this.onProgress({
      loaded: uploadedChunks * this.chunkSize,
      total: this.file.size,
      percentage: progress,
      uploadedChunks,
      totalChunks
    });
  }

  /**
   * 暂停上传
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * 恢复上传
   */
  resume() {
    if (this.isPaused && this.isUploading) {
      this.isPaused = false;
      // 重新开始上传剩余分块
      this.uploadChunks().catch(error => {
        this.onError(error);
      });
    }
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

export default ChunkedUploader;
