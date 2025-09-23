#!/bin/bash

# GHX Docker Compose 停止脚本

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

# 停止服务
stop_services() {
    print_message $BLUE "停止服务..."
    
    docker-compose down
    
    print_message $GREEN "服务已停止"
}

# 清理资源（可选）
cleanup() {
    local cleanup_flag=$1
    
    if [ "$cleanup_flag" = "--cleanup" ] || [ "$cleanup_flag" = "-c" ]; then
        print_message $YELLOW "清理 Docker 资源..."
        
        # 停止并删除容器
        docker-compose down --volumes --remove-orphans
        
        # 删除镜像
        docker-compose down --rmi all
        
        # 清理未使用的资源
        docker system prune -f
        
        print_message $GREEN "清理完成"
    fi
}

# 显示帮助信息
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --cleanup, -c    停止服务并清理所有相关资源"
    echo "  --help, -h       显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0               停止服务但保留数据"
    echo "  $0 --cleanup     停止服务并清理所有资源"
}

# 主函数
main() {
    local arg=$1
    
    case $arg in
        --help|-h)
            show_help
            exit 0
            ;;
        --cleanup|-c)
            print_message $GREEN "=== GHX Docker Compose 停止脚本 (清理模式) ==="
            stop_services
            cleanup $arg
            ;;
        "")
            print_message $GREEN "=== GHX Docker Compose 停止脚本 ==="
            stop_services
            ;;
        *)
            print_message $RED "未知选项: $arg"
            show_help
            exit 1
            ;;
    esac
    
    print_message $GREEN "=== 停止完成 ==="
}

# 运行主函数
main "$@"
