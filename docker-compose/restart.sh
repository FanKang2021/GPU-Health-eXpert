#!/bin/bash

# GHX Docker Compose 重启脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# 重启服务
restart_services() {
    print_message $BLUE "重启服务..."
    
    docker-compose restart
    
    print_message $GREEN "服务重启完成"
}

# 重新构建并启动
rebuild_and_start() {
    print_message $BLUE "重新构建并启动服务..."
    
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    
    print_message $GREEN "服务重新构建并启动完成"
}

# 显示服务状态
show_status() {
    print_message $BLUE "服务状态:"
    docker-compose ps
    
    print_message $BLUE "\n服务访问地址:"
    print_message $GREEN "GHX Dashboard: http://localhost:3000"
    print_message $GREEN "GHX Server API: http://localhost:5000"
}

# 显示帮助信息
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --rebuild, -r    重新构建镜像并启动服务"
    echo "  --help, -h       显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0               重启服务"
    echo "  $0 --rebuild     重新构建并启动服务"
}

# 主函数
main() {
    local arg=$1
    
    case $arg in
        --help|-h)
            show_help
            exit 0
            ;;
        --rebuild|-r)
            print_message $GREEN "=== GHX Docker Compose 重启脚本 (重建模式) ==="
            rebuild_and_start
            show_status
            ;;
        "")
            print_message $GREEN "=== GHX Docker Compose 重启脚本 ==="
            restart_services
            show_status
            ;;
        *)
            print_message $RED "未知选项: $arg"
            show_help
            exit 1
            ;;
    esac
    
    print_message $GREEN "=== 重启完成 ==="
}

# 运行主函数
main "$@"
