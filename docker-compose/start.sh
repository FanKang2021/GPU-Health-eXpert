#!/bin/bash

# GHX Docker Compose 启动脚本

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

# 检查Docker和Docker Compose是否安装
check_dependencies() {
    print_message $BLUE "检查依赖..."
    
    if ! command -v docker &> /dev/null; then
        print_message $RED "错误: Docker 未安装"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_message $RED "错误: Docker Compose 未安装"
        exit 1
    fi
    
    print_message $GREEN "依赖检查通过"
}

# 创建必要的目录
create_directories() {
    print_message $BLUE "创建必要的目录..."
    
    mkdir -p data/shared
    mkdir -p data/logs
    mkdir -p templates
    
    print_message $GREEN "目录创建完成"
}

# 检查环境配置文件
check_env_file() {
    if [ ! -f .env ]; then
        print_message $YELLOW "未找到 .env 文件，从模板创建..."
        if [ -f env.template ]; then
            cp env.template .env
            print_message $GREEN ".env 文件已创建，请根据需要修改配置"
        else
            print_message $RED "错误: 未找到 env.template 文件"
            exit 1
        fi
    fi
}

# 生成前端环境配置文件
generate_env_js() {
    print_message $BLUE "生成前端环境配置文件..."
    
    # 读取环境变量
    source .env 2>/dev/null || true
    
    # 设置默认值
    GHX_SERVER_PORT=${GHX_SERVER_PORT:-5000}
    
    # 生成env.js文件
    cat > env.js << EOF
// 环境配置 - 动态设置API地址
window.NEXT_PUBLIC_API_URL = "http://localhost:${GHX_SERVER_PORT}";
EOF
    
    print_message $GREEN "env.js 文件已生成，API地址: http://localhost:${GHX_SERVER_PORT}"
}

# 检查kubeconfig文件
check_kubeconfig() {
    local kubeconfig_path=$(grep KUBECONFIG_PATH .env 2>/dev/null | cut -d'=' -f2 | tr -d ' ' || echo "~/.kube/config")
    
    # 展开波浪号
    if [[ $kubeconfig_path == ~* ]]; then
        kubeconfig_path="${HOME}${kubeconfig_path#~}"
    fi
    
    if [ ! -f "$kubeconfig_path" ]; then
        print_message $YELLOW "警告: kubeconfig 文件不存在: $kubeconfig_path"
        print_message $YELLOW "请确保 Kubernetes 集群配置正确"
    else
        print_message $GREEN "kubeconfig 文件检查通过: $kubeconfig_path"
    fi
}

# 构建镜像
build_images() {
    print_message $BLUE "构建 Docker 镜像..."
    
    docker-compose build --no-cache
    
    print_message $GREEN "镜像构建完成"
}

# 启动服务
start_services() {
    print_message $BLUE "启动服务..."
    
    docker-compose up -d
    
    print_message $GREEN "服务启动完成"
}

# 显示服务状态
show_status() {
    print_message $BLUE "服务状态:"
    docker-compose ps
    
    print_message $BLUE "\n服务访问地址:"
    print_message $GREEN "GHX Dashboard: http://localhost:3000"
    print_message $GREEN "GHX Server API: http://localhost:5000"
}

# 主函数
main() {
    print_message $GREEN "=== GHX Docker Compose 启动脚本 ==="
    
    check_dependencies
    create_directories
    check_env_file
    generate_env_js
    check_kubeconfig
    build_images
    start_services
    show_status
    
    print_message $GREEN "=== 启动完成 ==="
}

# 运行主函数
main "$@"
