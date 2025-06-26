import sodium from 'libsodium-wrappers';

/**
 * 流式加密服务
 * 基于libsodium.js实现的流式加解密，支持大文件处理
 */
class StreamCrypto {
  constructor() {
    this.isReady = false;
    this.chunkSize = 64 * 1024; // 64KB chunks for streaming
  }

  /**
   * 初始化sodium库
   */
  async init() {
    if (!this.isReady) {
      await sodium.ready;
      this.isReady = true;
    }
  }

  /**
   * 生成密钥对
   * @returns {Promise<{publicKey: Uint8Array, privateKey: Uint8Array}>}
   */
  async generateKeyPair() {
    await this.init();
    return sodium.crypto_box_keypair();
  }

  /**
   * 生成对称加密密钥
   * @returns {Promise<Uint8Array>}
   */
  async generateSecretKey() {
    await this.init();
    return sodium.crypto_secretbox_keygen();
  }

  /**
   * 导出密钥为Base64字符串
   * @param {Uint8Array} key - 密钥
   * @returns {Promise<string>}
   */
  async exportKey(key) {
    await this.init();
    if (!key || !(key instanceof Uint8Array)) {
      throw new Error('密钥必须是Uint8Array');
    }
    return sodium.to_base64(key);
  }

  /**
   * 从Base64字符串导入密钥
   * @param {string} keyString - Base64编码的密钥
   * @returns {Uint8Array}
   */
  async importKey(keyString) {
    await this.init();

    if (typeof keyString !== 'string') {
      throw new Error('密钥必须是Base64字符串');
    }

    return sodium.from_base64(keyString);
  }

  /**
   * 流式加密文件（与分块上传兼容）
   * @param {File} file - 要加密的文件
   * @param {Uint8Array} key - 加密密钥
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<{encryptedData: Uint8Array, nonce: Uint8Array}>}
   */
  async encryptFileStream(file, key, onProgress = () => {}) {
    await this.init();

    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

    // 对于小文件（<80MB），使用内存加密
    if (file.size < 80 * 1024 * 1024) {
      return await this.encryptFileInMemory(file, key, nonce, onProgress);
    }

    // 对于大文件，使用流式加密但不合并到内存中
    // 这种情况下应该直接与分块上传集成
    throw new Error('大文件应该使用 encryptAndUploadChunked 方法');
  }

  /**
   * 内存中加密小文件
   */
  async encryptFileInMemory(file, key, nonce, onProgress) {
    const chunks = [];
    let processedBytes = 0;
    let chunkIndex = 0;

    // 创建文件读取器
    const reader = file.stream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // 为每个块创建唯一的nonce（基础nonce + 块索引）
        const chunkNonce = new Uint8Array(nonce);
        // 将块索引添加到nonce的末尾（确保每个块的nonce都不同）
        const indexBytes = new Uint8Array(4);
        new DataView(indexBytes.buffer).setUint32(0, chunkIndex, true);
        for (let i = 0; i < 4 && i < chunkNonce.length; i++) {
          chunkNonce[chunkNonce.length - 4 + i] = indexBytes[i];
        }

        // 加密当前块
        const encryptedChunk = sodium.crypto_secretbox_easy(value, chunkNonce, key);

        // 存储块大小信息（4字节）+ 加密数据
        const chunkWithSize = new Uint8Array(4 + encryptedChunk.length);
        new DataView(chunkWithSize.buffer).setUint32(0, encryptedChunk.length, true);
        chunkWithSize.set(encryptedChunk, 4);

        chunks.push(chunkWithSize);

        processedBytes += value.length;
        chunkIndex++;

        onProgress({
          loaded: processedBytes,
          total: file.size,
          percentage: Math.round((processedBytes / file.size) * 100)
        });
      }
    } finally {
      reader.releaseLock();
    }

    // 合并所有加密块
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const encryptedData = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      encryptedData.set(chunk, offset);
      offset += chunk.length;
    }

    return { encryptedData, nonce };
  }

  /**
   * 加密单个分块（用于分块上传）
   * @param {Uint8Array} chunkData - 分块数据
   * @param {Uint8Array} key - 加密密钥
   * @param {Uint8Array} nonce - 基础nonce
   * @param {number} chunkIndex - 分块索引
   * @returns {Promise<Uint8Array>} - 加密后的分块数据
   */
  async encryptChunk(chunkData, key, nonce, chunkIndex) {
    await this.init();

    // 为每个块创建唯一的nonce（基础nonce + 块索引）
    const chunkNonce = new Uint8Array(nonce);
    const indexBytes = new Uint8Array(4);
    new DataView(indexBytes.buffer).setUint32(0, chunkIndex, true);
    for (let i = 0; i < 4 && i < chunkNonce.length; i++) {
      chunkNonce[chunkNonce.length - 4 + i] = indexBytes[i];
    }

    // 加密分块
    const encryptedChunk = sodium.crypto_secretbox_easy(chunkData, chunkNonce, key);

    // 存储块大小信息（4字节）+ 加密数据
    const chunkWithSize = new Uint8Array(4 + encryptedChunk.length);
    new DataView(chunkWithSize.buffer).setUint32(0, encryptedChunk.length, true);
    chunkWithSize.set(encryptedChunk, 4);

    return chunkWithSize;
  }

  /**
   * 流式解密数据
   * @param {Uint8Array} encryptedData - 加密的数据
   * @param {Uint8Array} nonce - 随机数
   * @param {Uint8Array} key - 解密密钥
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Uint8Array>}
   */
  async decryptDataStream(encryptedData, nonce, key, onProgress = () => {}) {
    await this.init();

    const chunks = [];
    let processedBytes = 0;
    const totalBytes = encryptedData.length;
    let offset = 0;
    let chunkIndex = 0;

    // 按块解密
    while (offset < encryptedData.length) {
      // 读取块大小（4字节）
      if (offset + 4 > encryptedData.length) {
        throw new Error('解密失败：数据格式错误');
      }

      const chunkSize = new DataView(encryptedData.buffer, offset).getUint32(0, true);
      offset += 4;

      // 读取加密块数据
      if (offset + chunkSize > encryptedData.length) {
        throw new Error('解密失败：数据格式错误');
      }

      const encryptedChunk = encryptedData.slice(offset, offset + chunkSize);
      offset += chunkSize;

      // 重建块的nonce
      const chunkNonce = new Uint8Array(nonce);
      const indexBytes = new Uint8Array(4);
      new DataView(indexBytes.buffer).setUint32(0, chunkIndex, true);
      for (let i = 0; i < 4 && i < chunkNonce.length; i++) {
        chunkNonce[chunkNonce.length - 4 + i] = indexBytes[i];
      }

      try {
        const decryptedChunk = sodium.crypto_secretbox_open_easy(encryptedChunk, chunkNonce, key);
        chunks.push(decryptedChunk);
      } catch (error) {
        throw new Error(`解密失败：块 ${chunkIndex} 数据可能已损坏或密钥错误`);
      }

      processedBytes = offset;
      chunkIndex++;

      onProgress({
        loaded: processedBytes,
        total: totalBytes,
        percentage: Math.round((processedBytes / totalBytes) * 100)
      });
    }

    // 合并所有解密块
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const decryptedData = new Uint8Array(totalLength);
    let dataOffset = 0;

    for (const chunk of chunks) {
      decryptedData.set(chunk, dataOffset);
      dataOffset += chunk.length;
    }

    return decryptedData;
  }


}

// 创建单例实例
const streamCrypto = new StreamCrypto();

export default {
  // 流式加密API
  encryptFileStream: async (file, key, onProgress) => await streamCrypto.encryptFileStream(file, key, onProgress),
  encryptChunk: async (chunkData, key, nonce, chunkIndex) => await streamCrypto.encryptChunk(chunkData, key, nonce, chunkIndex),
  decryptDataStream: async (data, nonce, key, onProgress) => await streamCrypto.decryptDataStream(data, nonce, key, onProgress),

  // 密钥管理API
  generateKey: async () => await streamCrypto.generateSecretKey(),
  generateKeyPair: async () => await streamCrypto.generateKeyPair(),
  exportKey: async (key) => await streamCrypto.exportKey(key),
  importKey: async (keyString) => await streamCrypto.importKey(keyString)
};
