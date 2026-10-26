# ==========================================
# Stage 1: Build source với Node.js 22 Alpine
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Cache dependencies layer
COPY package.json package-lock.json ./
RUN npm ci

# Copy toàn bộ source code
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY scripts ./scripts

# Build production bundle
RUN npm run build

# ==========================================
# Stage 2: Runtime với Nginx Alpine tối ưu
# ==========================================
FROM nginx:alpine

# Làm sạch thư mục web mặc định
RUN rm -rf /usr/share/nginx/html/*

# Copy file build từ builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy cấu hình Nginx no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Health check kiểm tra dịch vụ sống
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
