# GHX Docker Compose 部署指南

本目录包含了使用 Docker Compose 部署 GHX (GPU Health Expert) 系统的完整配置和脚本。

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐
│  GHX Dashboard  │    │   GHX Server    │
│   (Frontend)    │◄──►│   (Backend)     │
│   Port: 3000    │    │   Port: 5000    │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────────────────┘
                    │
            ┌───────────────┐
            │   Kubernetes  │
            │   Cluster     │
            └───────────────┘
```

## 目录结构

```
docker-compose/
├── docker-compose.yml      # Docker Compose 配置文件
├── docker-compose.dev.yml  # 开发环境配置
├── env.template            # 环境变量配置模板
├── gpu-benchmarks.json     # GPU基准测试配置（后端使用）
├── gpu-benchmarks.js       # GPU基准测试配置（前端使用）
├── start.sh               # 启动脚本
├── stop.sh                # 停止脚本
├── restart.sh             # 重启脚本
├── status.sh              # 状态检查脚本
└── README.md              # 本文档
```

## 快速开始

### 1. 环境准备

确保系统已安装以下软件：
- Docker (20.10+)
- Docker Compose (1.29+)
- kubectl (用于 Kubernetes 集群访问)

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp env.template .env

# 编辑配置文件
vim .env
```

主要配置项：
- `KUBECONFIG_PATH`: kubeconfig 文件路径
- `K8S_NAMESPACE`: Kubernetes 命名空间
- `GPU_RESOURCE_NAME`: GPU 资源名称
- `SHARED_DATA_PATH`: 共享数据存储路径

### 3. 启动服务

```bash
# 使用启动脚本（推荐）
chmod +x *.sh
./start.sh

# 或直接使用 docker-compose
docker-compose up -d
```

### 4. 访问服务

- **GHX Dashboard**: http://localhost:3000
- **GHX Server API**: http://localhost:5000

## 服务说明

### GHX Server (后端服务)

- **端口**: 5000
- **功能**: 
  - 提供 REST API 接口
  - 管理 Kubernetes Job
  - 处理 GPU 健康检查请求
  - 数据收集和存储

- **挂载文件**:
  - `kubeconfig`: Kubernetes 集群配置
  - `job-template.yaml`: Job 模板文件
  - `burnin-job-template.yaml`: 烧机测试模板
  - `gpu-benchmarks-configmap.yaml`: GPU 基准测试配置

### GHX Dashboard (前端服务)

- **端口**: 3000
- **功能**:
  - 提供 Web 用户界面
  - 显示 GPU 状态和健康信息
  - 管理测试任务
  - 实时监控和告警

## 管理脚本

### start.sh - 启动脚本

```bash
./start.sh
```

功能：
- 检查依赖环境
- 创建必要目录
- 构建 Docker 镜像
- 启动所有服务
- 显示服务状态

### stop.sh - 停止脚本

```bash
# 停止服务但保留数据
./stop.sh

# 停止服务并清理所有资源
./stop.sh --cleanup
```

### restart.sh - 重启脚本

```bash
# 重启服务
./restart.sh

# 重新构建并启动
./restart.sh --rebuild
```

### status.sh - 状态检查脚本

```bash
# 显示基本状态
./status.sh

# 显示资源使用情况
./status.sh --resources

# 显示服务日志
./status.sh --logs

# 显示特定服务日志
./status.sh --logs ghx-server
```

## 数据存储

### 共享数据卷

- **路径**: `./data/shared`
- **用途**: 存储 GPU 检查结果、测试数据
- **挂载点**: `/shared`

### 日志数据卷

- **路径**: `./data/logs`
- **用途**: 存储服务日志
- **挂载点**: `/var/log`

## 网络配置

- **网络名称**: `ghx-network`
- **网络类型**: bridge
- **服务间通信**: 通过容器名称进行内部通信

## 健康检查

所有服务都配置了健康检查：

- **GHX Server**: `http://localhost:5000/health`
- **GHX Dashboard**: `http://localhost:3000`

检查间隔：30秒
超时时间：10秒
重试次数：3次

## 故障排除

### 1. 服务无法启动

```bash
# 检查服务状态
./status.sh

# 查看详细日志
./status.sh --logs

# 检查 Docker 日志
docker-compose logs
```

### 2. Kubernetes 连接问题

```bash
# 检查 kubeconfig 文件
kubectl cluster-info

# 检查命名空间
kubectl get namespaces

# 检查服务账户权限
kubectl auth can-i create jobs
```

### 3. 端口冲突

修改 `.env` 文件中的端口配置：
```bash
GHX_SERVER_PORT=5001
GHX_DASHBOARD_PORT=3001
```

### 4. 数据卷权限问题

```bash
# 检查数据目录权限
ls -la data/

# 修复权限
sudo chown -R $USER:$USER data/
```

## 开发模式

### 启用开发模式

在 `.env` 文件中设置：
```bash
DEV_MODE=true
FLASK_DEBUG=1
```

### 热重载

```bash
# 启用热重载
HOT_RELOAD=true
```

## 生产部署建议

1. **安全配置**:
   - 使用 HTTPS
   - 配置防火墙规则
   - 定期更新镜像

2. **监控**:
   - 配置日志收集
   - 设置监控告警
   - 定期备份数据

3. **性能优化**:
   - 调整资源限制
   - 配置缓存
   - 优化数据库查询

## 常见问题

### Q: 如何更新服务？

A: 使用重启脚本的重新构建模式：
```bash
./restart.sh --rebuild
```

### Q: 如何备份数据？

A: 备份 `data/` 目录：
```bash
tar -czf ghx-backup-$(date +%Y%m%d).tar.gz data/
```

### Q: 如何查看服务资源使用情况？

A: 使用状态脚本：
```bash
./status.sh --resources
```

### Q: 如何清理所有数据？

A: 使用停止脚本的清理模式：
```bash
./stop.sh --cleanup
```

## 技术支持

如有问题，请查看：
1. 服务日志：`./status.sh --logs`
2. Docker 日志：`docker-compose logs`
3. 系统资源：`./status.sh --resources`

## 更新日志

- v1.0.0: 初始版本，支持基本的 Docker Compose 部署
- 移除了 nginx 反向代理，简化架构
- 添加了完整的管理脚本
- 支持环境变量配置
