#!/bin/bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SERVICES=(
  cms
)

# Đảm bảo file .env tồn tại
if [ ! -f .env ]; then
  echo -e "${YELLOW}📝 .env chưa tồn tại, copy từ .env.example...${NC}"
  cp .env.example .env
fi

# Đảm bảo network chung tồn tại
docker network create cskh-vip-net 2>/dev/null || true

echo -e "${YELLOW}🔄 Pull code mới nhất từ Git...${NC}"
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
git pull origin "$BRANCH"

echo -e "${YELLOW}🧱 Build lại các service (không dùng cache)...${NC}"
docker compose build --no-cache "${SERVICES[@]}"

echo -e "${YELLOW}🚀 Khởi động lại các service...${NC}"
docker compose up -d --force-recreate "${SERVICES[@]}"

echo -e "${GREEN}✅ Done!${NC}"
