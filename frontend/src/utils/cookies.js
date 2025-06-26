/**
 * Cookie管理工具
 */

/**
 * 设置Cookie
 * @param {string} name - Cookie名称
 * @param {string} value - Cookie值
 * @param {number} minutes - 过期时间（分钟）
 * @param {string} path - 路径，默认为 '/'
 */
export function setCookie(name, value, minutes = 30, path = '/') {
  const date = new Date();
  date.setTime(date.getTime() + (minutes * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=${path};SameSite=Strict`;
}

/**
 * 获取Cookie
 * @param {string} name - Cookie名称
 * @returns {string|null} - Cookie值，如果不存在返回null
 */
export function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') {
      c = c.substring(1, c.length);
    }
    if (c.indexOf(nameEQ) === 0) {
      return c.substring(nameEQ.length, c.length);
    }
  }
  return null;
}

/**
 * 删除Cookie
 * @param {string} name - Cookie名称
 * @param {string} path - 路径，默认为 '/'
 */
export function deleteCookie(name, path = '/') {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=${path};`;
}

/**
 * 检查Cookie是否存在
 * @param {string} name - Cookie名称
 * @returns {boolean} - 是否存在
 */
export function hasCookie(name) {
  return getCookie(name) !== null;
}

/**
 * 会话相关的Cookie操作
 */

// Cookie名称常量
export const COOKIE_NAMES = {
  SESSION_INFO: 'ft_session_info',  // 文件传输会话信息
  SESSION_TOKEN: 'ft_session_token' // 会话令牌
};

/**
 * 设置会话Cookie
 * @param {string} matchCode - 匹配码
 * @param {string} clientToken - 客户端令牌
 * @param {string} sessionToken - 会话令牌
 */
export function setSessionCookie(matchCode, clientToken, sessionToken) {
  const sessionInfo = {
    matchCode,
    clientToken,
    sessionToken,
    timestamp: Date.now()
  };
  
  // 设置30分钟过期
  setCookie(COOKIE_NAMES.SESSION_INFO, JSON.stringify(sessionInfo), 30);
}

/**
 * 获取会话Cookie
 * @returns {object|null} - 会话信息对象，如果不存在或过期返回null
 */
export function getSessionCookie() {
  const sessionInfoStr = getCookie(COOKIE_NAMES.SESSION_INFO);
  if (!sessionInfoStr) {
    return null;
  }
  
  try {
    const sessionInfo = JSON.parse(sessionInfoStr);
    
    // 检查是否过期（30分钟）
    const now = Date.now();
    const expireTime = 30 * 60 * 1000; // 30分钟
    
    if (now - sessionInfo.timestamp > expireTime) {
      // 过期，删除cookie
      deleteSessionCookie();
      return null;
    }
    
    return sessionInfo;
  } catch (error) {
    console.error('Failed to parse session cookie:', error);
    deleteSessionCookie();
    return null;
  }
}

/**
 * 删除会话Cookie
 */
export function deleteSessionCookie() {
  deleteCookie(COOKIE_NAMES.SESSION_INFO);
}

/**
 * 检查是否有有效的会话Cookie
 * @returns {boolean} - 是否有有效的会话Cookie
 */
export function hasValidSessionCookie() {
  return getSessionCookie() !== null;
}

/**
 * 更新会话Cookie的时间戳（延长有效期）
 */
export function refreshSessionCookie() {
  const sessionInfo = getSessionCookie();
  if (sessionInfo) {
    sessionInfo.timestamp = Date.now();
    setCookie(COOKIE_NAMES.SESSION_INFO, JSON.stringify(sessionInfo), 30);
  }
}
