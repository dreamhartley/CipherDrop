/**
 * 生成一个可用于 AES-GCM 加密的随机密钥。
 * @returns {Promise<CryptoKey>}
 */
async function generateKey() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // a boolean value indicating whether it will be possible to export the key.
    ['encrypt', 'decrypt']
  );
}

/**
 * 将 CryptoKey 导出为可传输的格式 (JWK)。
 * @param {CryptoKey} key
 * @returns {Promise<JsonWebKey>}
 */
async function exportKey(key) {
  return await window.crypto.subtle.exportKey('jwk', key);
}

/**
 * 从 JWK 格式导入密钥。
 * @param {JsonWebKey} jwk
 * @returns {Promise<CryptoKey>}
 */
async function importKey(jwk) {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * 使用 AES-GCM 加密文件数据。
 * @param {ArrayBuffer} data - The file data to encrypt.
 * @param {CryptoKey} key - The encryption key.
 * @returns {Promise<ArrayBuffer>} - The encrypted data, prefixed with the IV.
 */
async function encrypt(data, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // Initialization Vector
  const encryptedData = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    data
  );

  // 将 IV 和加密数据合并为一个 ArrayBuffer
  const result = new Uint8Array(iv.length + encryptedData.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encryptedData), iv.length);

  return result.buffer;
}

/**
 * 使用 AES-GCM 解密数据。
 * @param {ArrayBuffer} data - The data to decrypt, with IV prefix.
 * @param {CryptoKey} key - The decryption key.
 * @returns {Promise<ArrayBuffer>} - The decrypted data.
 */
async function decrypt(data, key) {
  const iv = data.slice(0, 12);
  const encryptedData = data.slice(12);

  return await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encryptedData
  );
}


export default {
  generateKey,
  exportKey,
  importKey,
  encrypt,
  decrypt,
};