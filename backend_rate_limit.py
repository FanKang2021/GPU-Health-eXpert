#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GPU节点状态API频率限制实现 - 最终简化版本
完全基于内存缓存，无外部依赖
"""

import time
from functools import wraps
from collections import defaultdict
from flask import request, jsonify

# 全局缓存：{client_ip: {endpoint: last_request_time}}
request_cache = defaultdict(dict)

def rate_limit_memory(limit_seconds=60):
    """基于内存的频率限制装饰器"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr
            endpoint = f.__name__
            
            current_time = time.time()
            last_request_time = request_cache[client_ip].get(endpoint)
            
            # 如果存在上次请求时间，检查是否超过限制
            if last_request_time is not None:
                time_diff = current_time - last_request_time
                
                if time_diff < limit_seconds:
                    remaining_time = int(limit_seconds - time_diff)
                    
                    # 记录被拒绝的请求
                    print(f"[RATE_LIMIT] BLOCKED: {client_ip} -> {endpoint}, remaining: {remaining_time}s")
                    
                    return jsonify({
                        "error": "请求过于频繁",
                        "message": f"请等待 {remaining_time} 秒后再试",
                        "remaining_seconds": remaining_time,
                        "limit_seconds": limit_seconds
                    }), 429  # Too Many Requests
            
            # 更新最后请求时间
            request_cache[client_ip][endpoint] = current_time
            
            # 记录允许的请求
            print(f"[RATE_LIMIT] ALLOWED: {client_ip} -> {endpoint}")
            
            # 定期清理过期记录
            if int(current_time) % 30 == 0:  # 每30秒清理一次
                cleanup_expired_records()
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def cleanup_expired_records():
    """清理过期的缓存记录"""
    current_time = time.time()
    expired_clients = []
    
    for client_ip, endpoints in request_cache.items():
        expired_endpoints = []
        for endpoint, last_time in endpoints.items():
            if current_time - last_time > 60:  # 60秒后过期
                expired_endpoints.append(endpoint)
        
        for endpoint in expired_endpoints:
            del endpoints[endpoint]
        
        if not endpoints:
            expired_clients.append(client_ip)
    
    for client_ip in expired_clients:
        del request_cache[client_ip]
    
    print(f"[RATE_LIMIT] Cleaned up expired records. Active clients: {len(request_cache)}")

# 获取频率限制装饰器
def get_rate_limit_decorator():
    """获取可用的频率限制装饰器，为不同操作提供不同的限制"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr
            endpoint = f.__name__
            
            # 检查是否是删除操作
            is_delete_operation = endpoint in ['delete_job', 'delete_jobs', 'delete_diagnostic_result']
            # 检查是否是列表查询操作
            is_list_operation = endpoint in ['list_jobs', 'list_diagnostic_results', 'list_gpu_inspection_jobs']
            # 检查是否是诊断结果查询操作（更宽松的限制）
            is_diagnostic_query = endpoint in ['get_diagnostic_results']
            
            # 为不同操作提供不同的限制
            if is_delete_operation:
                # 删除操作：每分钟最多10次
                limit_seconds = 6  # 每6秒一次
            elif is_diagnostic_query:
                # 诊断结果查询：更宽松的限制，每0.5秒一次
                limit_seconds = 0.5  # 每0.5秒一次
            elif is_list_operation:
                # 列表查询：每分钟最多60次
                limit_seconds = 1  # 每1秒一次
            else:
                # 其他操作：每分钟最多20次
                limit_seconds = 3  # 每3秒一次
            
            current_time = time.time()
            last_request_time = request_cache[client_ip].get(endpoint)
            
            # 如果存在上次请求时间，检查是否超过限制
            if last_request_time is not None:
                time_diff = current_time - last_request_time
                
                if time_diff < limit_seconds:
                    remaining_time = int(limit_seconds - time_diff)
                    
                    # 记录被拒绝的请求
                    print(f"[RATE_LIMIT] BLOCKED: {client_ip} -> {endpoint}, remaining: {remaining_time}s, limit: {limit_seconds}s")
                    
                    return jsonify({
                        "error": "请求过于频繁",
                        "message": f"请等待 {remaining_time} 秒后再试",
                        "remaining_seconds": remaining_time,
                        "limit_seconds": limit_seconds
                    }), 429  # Too Many Requests
            
            # 更新最后请求时间
            request_cache[client_ip][endpoint] = current_time
            
            # 记录允许的请求
            print(f"[RATE_LIMIT] ALLOWED: {client_ip} -> {endpoint}, limit: {limit_seconds}s")
            
            # 定期清理过期记录
            if int(current_time) % 30 == 0:  # 每30秒清理一次
                cleanup_expired_records()
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# 设置错误处理器
def setup_rate_limit_error_handlers(app):
    """设置频率限制错误处理器"""
    
    @app.errorhandler(429)
    def ratelimit_handler(e):
        """处理429错误"""
        return jsonify({
            "error": "请求过于频繁",
            "message": "请等待1分钟后再试",
            "remaining_seconds": 60
        }), 429

# 初始化频率限制
def init_rate_limit(app, use_redis=False, use_flask_limiter=False):
    """初始化频率限制"""
    print("使用内存缓存进行频率限制")
    return "memory"

# 获取频率限制统计
def get_rate_limit_stats():
    """获取频率限制统计信息"""
    total_endpoints = sum(len(endpoints) for endpoints in request_cache.values())
    return {
        "type": "memory",
        "active_clients": len(request_cache),
        "active_limits": total_endpoints,
        "cache_type": "volatile",
        "status": "working"
    }

# 记录频率限制事件
def log_rate_limit_event(client_ip, endpoint, action="blocked"):
    """记录频率限制事件"""
    current_time = time.strftime("%Y-%m-%d %H:%M:%S")
    log_message = f"[{current_time}] Rate limit {action}: {client_ip} -> {endpoint}"
    print(log_message)

if __name__ == "__main__":
    print("频率限制模块加载成功！")
    print("使用简化的内存缓存频率限制")
