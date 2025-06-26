/**
 * 生成一个指定长度的随机字母数字字符串作为匹配码。
 * @param {number} length - 匹配码的长度，默认为6。
 * @returns {string} 生成的匹配码。
 */
function generateMatchCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = { generateMatchCode };