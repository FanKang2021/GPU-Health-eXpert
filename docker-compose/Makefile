# GHX Docker Compose Makefile

.PHONY: help build up down restart status logs clean dev prod

# 默认目标
help:
	@echo "GHX Docker Compose 管理命令"
	@echo ""
	@echo "生产环境命令:"
	@echo "  make build     构建所有镜像"
	@echo "  make up        启动所有服务"
	@echo "  make down      停止所有服务"
	@echo "  make restart   重启所有服务"
	@echo "  make status    查看服务状态"
	@echo "  make logs      查看服务日志"
	@echo "  make clean     清理所有资源"
	@echo ""
	@echo "开发环境命令:"
	@echo "  make dev       启动开发环境"
	@echo "  make dev-down  停止开发环境"
	@echo "  make dev-logs  查看开发环境日志"
	@echo ""
	@echo "其他命令:"
	@echo "  make help      显示此帮助信息"

# 生产环境命令
build:
	@echo "构建 Docker 镜像..."
	docker-compose build --no-cache

up:
	@echo "启动生产环境服务..."
	docker-compose up -d

down:
	@echo "停止生产环境服务..."
	docker-compose down

restart:
	@echo "重启生产环境服务..."
	docker-compose restart

status:
	@echo "查看服务状态..."
	docker-compose ps
	@echo ""
	@echo "服务访问地址:"
	@echo "GHX Dashboard: http://localhost:3000"
	@echo "GHX Server API: http://localhost:5000"

logs:
	@echo "查看服务日志..."
	docker-compose logs -f

clean:
	@echo "清理所有资源..."
	docker-compose down --volumes --remove-orphans
	docker-compose down --rmi all
	docker system prune -f

# 开发环境命令
dev:
	@echo "启动开发环境..."
	docker-compose -f docker-compose.dev.yml up -d

dev-down:
	@echo "停止开发环境..."
	docker-compose -f docker-compose.dev.yml down

dev-logs:
	@echo "查看开发环境日志..."
	docker-compose -f docker-compose.dev.yml logs -f

# 快速启动脚本
start: build up status

# 快速停止脚本
stop: down

# 快速重启脚本
restart-all: down up status
