import { io } from 'socket.io-client';

// "undefined" a特殊值，Vite会将其替换为服务器的URL
// 在开发中，由于有代理，它会连接到 'ws://localhost:5173/socket.io'，然后被代理到 3001 端口
// 在生产中，它会连接到同源的服务器
const URL = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5173';

export const socket = io(URL, {
  autoConnect: false, // 我们将手动连接
  reconnection: true, // 启用重连
  reconnectionAttempts: 5, // 最多重连5次
  reconnectionDelay: 1000, // 重连延迟1秒
  reconnectionDelayMax: 5000, // 最大重连延迟5秒
  timeout: 20000, // 连接超时20秒
  forceNew: false, // 不强制创建新连接
});