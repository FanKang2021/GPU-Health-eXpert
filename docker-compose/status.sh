#!/bin/bash

# GHX Docker Compose 状态检查脚本

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

# 检查服务状态
check_services() {
    print_message $BLUE "=== 服务状态 ==="
    docker-compose ps
    echo ""
}

# 检查服务健康状态
check_health() {
    print_message $BLUE "=== 健康检查 ==="
    
    # 检查 ghx-server
    if docker-compose ps ghx-server | grep -q "Up"; then
        if curl -s -f http://localhost:5000/health > /dev/null 2>&1; then
            print_message $GREEN "✓ GHX Server: 健康"
        else
            print_message $YELLOW "⚠ GHX Server: 运行中但健康检查失败"
        fi
    else
        print_message $RED "✗ GHX Server: 未运行"
    fi
    
    # 检查 ghx-dashboard
    if docker-compose ps ghx-dashboard | grep -q "Up"; then
        if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
            print_message $GREEN "✓ GHX Dashboard: 健康"
        else
            print_message $YELLOW "⚠ GHX Dashboard: 运行中但健康检查失败"
        fi
    else
        print_message $RED "✗ GHX Dashboard: 未运行"
    fi
    echo ""
}

# 显示服务访问信息
show_access_info() {
    print_message $BLUE "=== 访问信息 ==="
    print_message $GREEN "GHX Dashboard: http://localhost:3000"
    print_message $GREEN "GHX Server API: http://localhost:5000"
    echo ""
}

# 显示资源使用情况
show_resources() {
    print_message $BLUE "=== 资源使用情况 ==="
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
    echo ""
}

# 显示日志信息
show_logs() {
    local service=$1
    local lines=${2:-50}
    
    if [ -n "$service" ]; then
        print_message $BLUE "=== $service 最近 $lines 行日志 ==="
        docker-compose logs --tail=$lines $service
    else
        print_message $BLUE "=== 所有服务最近 $lines 行日志 ==="
        docker-compose logs --tail=$lines
    fi
    echo ""
}

# 显示帮助信息
show_help() {
    echo "用法: $0 [选项] [服务名]"
    echo ""
    echo "选项:"
    echo "  --logs, -l [服务名]    显示日志 (默认显示所有服务)"
    echo "  --lines, -n 行数       指定显示的日志行数 (默认50)"
    echo "  --resources, -r        显示资源使用情况"
    echo "  --help, -h             显示此帮助信息"
    echo ""
    echo "服务名:"
    echo "  ghx-server             GHX 后端服务"
    echo "  ghx-dashboard          GHX 前端服务"
    echo ""
    echo "示例:"
    echo "  $0                     显示基本状态信息"
    echo "  $0 --logs              显示所有服务日志"
    echo "  $0 --logs ghx-server   显示 ghx-server 日志"
    echo "  $0 --resources         显示资源使用情况"
}

# 主函数
main() {
    local show_logs_flag=false
    local show_resources_flag=false
    local service_name=""
    local log_lines=50
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --logs|-l)
                show_logs_flag=true
                if [[ $# -gt 1 && ! $2 =~ ^-- ]]; then
                    service_name=$2
                    shift
                fi
                shift
                ;;
            --lines|-n)
                if [[ $# -gt 1 && $2 =~ ^[0-9]+$ ]]; then
                    log_lines=$2
                    shift
                else
                    print_message $RED "错误: --lines 需要指定数字"
                    exit 1
                fi
                shift
                ;;
            --resources|-r)
                show_resources_flag=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                if [[ $1 =~ ^(ghx-server|ghx-dashboard)$ ]]; then
                    service_name=$1
                else
                    print_message $RED "未知选项: $1"
                    show_help
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    print_message $GREEN "=== GHX Docker Compose 状态检查 ==="
    
    check_services
    check_health
    show_access_info
    
    if [ "$show_resources_flag" = true ]; then
        show_resources
    fi
    
    if [ "$show_logs_flag" = true ]; then
        show_logs "$service_name" "$log_lines"
    fi
}

# 运行主函数
main "$@"
