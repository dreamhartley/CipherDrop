/**
 * 上传配置
 */
export const uploadConfig = {
  // 分块上传配置
  chunked: {
    // 分块大小 (50MB)
    chunkSize: 50 * 1024 * 1024,
    
    // 触发分块上传的文件大小阈值 (80MB)
    // 超过此大小的文件将使用分块上传
    threshold: 80 * 1024 * 1024,
    
    // 最大并发上传数
    maxConcurrentUploads: 3,
    
    // 重试次数
    retryAttempts: 3,
    
    // 重试延迟 (毫秒)
    retryDelay: 1000
  },
  
  // 普通上传配置
  normal: {
    // 最大文件大小 (100MB - Cloudflare 免费套餐限制)
    maxFileSize: 100 * 1024 * 1024,
    
    // 超时时间 (10分钟)
    timeout: 10 * 60 * 1000
  },
  
  // 支持的文件类型
  allowedTypes: {
    // 图片类型
    images: [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/svg+xml'
    ],
    
    // 文档类型
    documents: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    ],
    
    // 压缩文件
    archives: [
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/gzip',
      'application/x-tar'
    ],
    
    // 音频文件
    audio: [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/aac'
    ],
    
    // 视频文件
    video: [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/wmv',
      'video/flv',
      'video/webm'
    ]
  }
};

/**
 * 检查文件是否需要分块上传
 * @param {File} file - 文件对象
 * @returns {boolean} - 是否需要分块上传
 */
export function shouldUseChunkedUpload(file) {
  return file.size > uploadConfig.chunked.threshold;
}

/**
 * 检查文件大小是否超过限制
 * @param {File} file - 文件对象
 * @returns {boolean} - 是否超过限制
 */
export function isFileSizeValid(file) {
  // 如果支持分块上传，则没有大小限制
  if (shouldUseChunkedUpload(file)) {
    return true;
  }
  
  // 普通上传检查大小限制
  return file.size <= uploadConfig.normal.maxFileSize;
}

/**
 * 检查文件类型是否被支持
 * @param {File} file - 文件对象
 * @returns {boolean} - 是否支持该文件类型
 */
export function isFileTypeSupported(file) {
  // 文件传输助手支持所有文件类型
  return true;
}

/**
 * 获取文件类型分类
 * @param {File} file - 文件对象
 * @returns {string} - 文件类型分类
 */
export function getFileCategory(file) {
  const { allowedTypes } = uploadConfig;

  if (allowedTypes.images.includes(file.type)) {
    return 'image';
  }

  if (allowedTypes.documents.includes(file.type) || file.type.startsWith('text/')) {
    return 'document';
  }

  if (allowedTypes.archives.includes(file.type)) {
    return 'archive';
  }

  if (allowedTypes.audio.includes(file.type)) {
    return 'audio';
  }

  if (allowedTypes.video.includes(file.type)) {
    return 'video';
  }

  // 支持所有其他文件类型
  return 'file';
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} - 格式化后的文件大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 验证文件
 * @param {File} file - 文件对象
 * @returns {object} - 验证结果
 */
export function validateFile(file) {
  const result = {
    valid: true,
    errors: []
  };

  // 检查文件大小（只有在不支持分块上传时才检查）
  if (!isFileSizeValid(file)) {
    result.valid = false;
    result.errors.push(`文件大小超过限制 (${formatFileSize(uploadConfig.normal.maxFileSize)})`);
  }

  // 文件传输助手支持所有文件类型，不进行类型检查

  return result;
}

export default uploadConfig;
