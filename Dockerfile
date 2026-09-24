# syntax=docker/dockerfile:1

# ---- 构建阶段：安装依赖 ----
FROM node:20-alpine AS build
WORKDIR /app

# 优先复制依赖清单，充分利用构建缓存
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ---- 运行阶段：仅携带产物与运行时依赖 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 以非 root 用户运行；数据目录可挂载卷用于持久化
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

USER node
ENV PERSIST_FILE=/data/family.json
EXPOSE 3000

CMD ["node", "server.js"]
