import { createRouter, createWebHistory } from 'vue-router';
import LandingPage from '../views/LandingPage.vue';
import SessionPage from '../views/SessionPage.vue';
import { getSessionCookie, hasValidSessionCookie } from '../utils/cookies.js';

// 生成会话令牌
function generateSessionToken() {
  return 'st_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 会话令牌存储
const sessionTokens = new Map(); // token -> { matchCode, timestamp, used }

// 创建会话令牌
export function createSessionToken(matchCode) {
  const token = generateSessionToken();
  sessionTokens.set(token, {
    matchCode,
    timestamp: Date.now(),
    used: false
  });

  // 5分钟后自动清理未使用的令牌
  setTimeout(() => {
    const tokenData = sessionTokens.get(token);
    if (tokenData && !tokenData.used) {
      sessionTokens.delete(token);
    }
  }, 5 * 60 * 1000);

  return token;
}

// 验证并使用会话令牌
export function validateAndUseSessionToken(token) {
  const tokenData = sessionTokens.get(token);
  if (!tokenData) {
    return null;
  }

  // 检查令牌是否过期（5分钟）
  if (Date.now() - tokenData.timestamp > 5 * 60 * 1000) {
    sessionTokens.delete(token);
    return null;
  }

  // 标记为已使用
  tokenData.used = true;

  return tokenData.matchCode;
}

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: LandingPage,
  },
  {
    path: '/room/:sessionToken',
    name: 'Session',
    component: SessionPage,
    props: true,
    beforeEnter: (to, from, next) => {
      const sessionToken = to.params.sessionToken;

      // 首先尝试验证会话令牌
      let matchCode = validateAndUseSessionToken(sessionToken);

      // 如果令牌无效，检查是否有有效的会话cookie（用于页面刷新）
      if (!matchCode) {
        const sessionCookie = getSessionCookie();
        if (sessionCookie && sessionCookie.sessionToken === sessionToken) {
          // Cookie中的会话令牌匹配，允许访问
          matchCode = sessionCookie.matchCode;
        }
      }

      if (!matchCode) {
        // 令牌无效且没有有效cookie，重定向到主页
        next('/');
        return;
      }

      // 将匹配码和会话令牌传递给组件
      to.params.matchCode = matchCode;
      to.params.sessionToken = sessionToken;
      next();
    }
  },
  {
    // 捕获所有其他路由，重定向到主页
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 全局路由守卫
router.beforeEach((to, from, next) => {
  // 如果试图直接访问旧的session路径，重定向到主页
  if (to.path.startsWith('/session/')) {
    next('/');
    return;
  }

  // 如果试图直接访问/room路径
  if (to.path.startsWith('/room/')) {
    // 检查是否有有效的会话cookie
    if (hasValidSessionCookie()) {
      // 有有效cookie，允许访问（页面刷新或书签访问）
      next();
      return;
    }

    // 检查是否是从主页正常跳转
    if (from.name === 'Landing') {
      // 从主页跳转，允许访问
      next();
      return;
    }

    // 没有有效cookie且不是从主页跳转，重定向到主页
    next('/');
    return;
  }

  next();
});

export default router;