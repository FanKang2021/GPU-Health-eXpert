@echo off
REM GHX Docker Compose Windows 停止脚本

echo ========================================
echo GHX Docker Compose 停止脚本
echo ========================================

REM 停止服务
echo 停止服务...
docker-compose down

if %errorlevel% neq 0 (
    echo 错误: 服务停止失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo 服务已停止
echo ========================================
pause
