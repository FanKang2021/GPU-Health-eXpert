@echo off
REM GHX Docker Compose Windows 启动脚本

echo ========================================
echo GHX Docker Compose 启动脚本
echo ========================================

REM 检查Docker是否运行
docker version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: Docker 未运行或未安装
    pause
    exit /b 1
)

REM 检查Docker Compose是否可用
docker-compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: Docker Compose 未安装
    pause
    exit /b 1
)

REM 创建必要的目录
if not exist "data\shared" mkdir data\shared
if not exist "data\logs" mkdir data\logs
if not exist "templates" mkdir templates

REM 检查环境配置文件
if not exist ".env" (
    if exist "env.template" (
        echo 创建 .env 文件...
        copy env.template .env
        echo .env 文件已创建，请根据需要修改配置
    ) else (
        echo 错误: 未找到 env.template 文件
        pause
        exit /b 1
    )
)

REM 生成前端环境配置文件
echo 生成前端环境配置文件...
for /f "tokens=2 delims==" %%a in ('findstr "GHX_SERVER_PORT" .env 2^>nul') do set GHX_SERVER_PORT=%%a
if not defined GHX_SERVER_PORT set GHX_SERVER_PORT=5000

echo // 环境配置 - 动态设置API地址 > env.js
echo window.NEXT_PUBLIC_API_URL = "http://localhost:%GHX_SERVER_PORT%"; >> env.js

echo env.js 文件已生成，API地址: http://localhost:%GHX_SERVER_PORT%

REM 构建镜像
echo 构建 Docker 镜像...
docker-compose build --no-cache
if %errorlevel% neq 0 (
    echo 错误: 镜像构建失败
    pause
    exit /b 1
)

REM 启动服务
echo 启动服务...
docker-compose up -d
if %errorlevel% neq 0 (
    echo 错误: 服务启动失败
    pause
    exit /b 1
)

REM 显示服务状态
echo.
echo 服务状态:
docker-compose ps

echo.
echo 服务访问地址:
echo GHX Dashboard: http://localhost:3000
echo GHX Server API: http://localhost:5000

echo.
echo ========================================
echo 启动完成
echo ========================================
pause
