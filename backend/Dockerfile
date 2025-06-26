# 使用官方Node.js运行时作为基础镜像
FROM node:22-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install --only=production

# 复制应用源代码
COPY . .

# 创建存储目录
RUN mkdir -p storage

# 暴露端口
EXPOSE 3001

# 设置环境变量
ENV NODE_ENV=production

# 创建非root用户
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# 更改存储目录所有权
RUN chown -R nodejs:nodejs /app/storage

# 切换到非root用户
USER nodejs

# 启动应用
CMD ["npm", "start"]
