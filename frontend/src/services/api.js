import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api', // Vite 代理会处理这个前缀
  headers: {
    'Content-Type': 'application/json',
  },
});

export default {
  /**
   * 从后端获取一个新的匹配码
   * @returns {Promise<{code: string}>}
   */
  getMatchCode() {
    return apiClient.get('/code').then(res => res.data);
  },

  /**
   * 上传文件到服务器
   * @param {File} file - 要上传的文件
   * @param {Function} onUploadProgress - 进度回调函数
   * @param {string} sessionId - 会话ID
   * @returns {Promise<object>} - 包含文件元数据和下载链接的响应
   */
  uploadFile(file, onUploadProgress, sessionId) {
    const formData = new FormData();
    formData.append('file', file);

    const headers = {
      'Content-Type': 'multipart/form-data',
    };

    if (sessionId) {
      headers['X-Session-Id'] = sessionId;
    }

    return apiClient.post('/upload', formData, {
      headers,
      onUploadProgress,
    }).then(res => res.data);
  },

  /**
   * 下载文件
   * @param {string} downloadUrl - 文件下载URL
   * @returns {Promise<ArrayBuffer>} - 文件数据
   */
  async downloadFile(downloadUrl) {
    // 确保使用正确的基础URL
    const url = downloadUrl.startsWith('/') ? downloadUrl : `/${downloadUrl}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  },

  /**
   * 分块上传相关API
   */
  chunkedUpload: {
    /**
     * 初始化分块上传
     * @param {string} fileName - 文件名
     * @param {number} fileSize - 文件大小
     * @param {number} totalChunks - 总分块数
     * @param {string} mimeType - MIME类型
     * @param {string} sessionId - 会话ID
     * @returns {Promise<{uploadId: string}>}
     */
    init(fileName, fileSize, totalChunks, mimeType, sessionId) {
      const headers = {};
      if (sessionId) {
        headers['X-Session-Id'] = sessionId;
      }

      return apiClient.post('/upload/init', {
        fileName,
        fileSize,
        totalChunks,
        mimeType
      }, { headers }).then(res => res.data);
    },

    /**
     * 上传单个分块
     * @param {string} uploadId - 上传ID
     * @param {number} chunkIndex - 分块索引
     * @param {Blob} chunkData - 分块数据
     * @param {Function} onUploadProgress - 进度回调
     * @returns {Promise<{success: boolean, progress: object}>}
     */
    uploadChunk(uploadId, chunkIndex, chunkData, onUploadProgress) {
      const formData = new FormData();
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', chunkIndex.toString());
      formData.append('chunk', chunkData);

      return apiClient.post('/upload/chunk', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress,
      }).then(res => res.data);
    },

    /**
     * 完成分块上传
     * @param {string} uploadId - 上传ID
     * @returns {Promise<object>} - 文件信息
     */
    complete(uploadId) {
      return apiClient.post('/upload/complete', {
        uploadId
      }).then(res => res.data);
    },

    /**
     * 获取上传进度
     * @param {string} uploadId - 上传ID
     * @returns {Promise<object>} - 进度信息
     */
    getProgress(uploadId) {
      return apiClient.get(`/upload/progress/${uploadId}`).then(res => res.data);
    },

    /**
     * 取消上传
     * @param {string} uploadId - 上传ID
     * @returns {Promise<{success: boolean}>}
     */
    cancel(uploadId) {
      return apiClient.delete(`/upload/${uploadId}`).then(res => res.data);
    }
  },

  /**
   * 获取会话存储使用情况
   * @param {string} sessionId - 会话ID
   * @returns {Promise<object>} - 存储使用情况
   */
  getSessionStorageUsage(sessionId) {
    return apiClient.get(`/session/${sessionId}/storage`).then(res => res.data);
  }
};