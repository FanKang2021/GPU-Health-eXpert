#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GHX (GPU Health Expert) 统一服务 - 集成数据收集、节点状态查询和Job管理
整合了原gpu_collector_service和gpu_cli的功能
提供完整的GPU健康检查解决方案
"""

import sqlite3
from datetime import datetime, timedelta
from datetime import timezone
from functools import wraps
import json
import logging
import os
import subprocess
import time
import uuid
import glob
import queue
import threading
import yaml
from typing import Dict, Any, List, Optional
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# 添加kubernetes客户端导入
try:
    from kubernetes import client, config, watch
    from kubernetes.client.rest import ApiException
    KUBERNETES_AVAILABLE = True
except ImportError:
    KUBERNETES_AVAILABLE = False
    print("Warning: kubernetes package not available, falling back to kubectl commands")

# 导入backend_rate_limit模块
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/ghx_service.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

try:
    from backend_rate_limit import (
        get_rate_limit_decorator,
        setup_rate_limit_error_handlers,
        init_rate_limit,
        get_rate_limit_stats,
        log_rate_limit_event
    )
    logger.info("成功导入backend_rate_limit模块")
except ImportError:
    logger.warning("无法导入backend_rate_limit模块，使用简单限流")
    
    def get_rate_limit_decorator():
        """简单的限流装饰器"""
        def decorator(f):
            @wraps(f)
            def decorated_function(*args, **kwargs):
                return f(*args, **kwargs)
            return decorated_function
        return decorator

    def setup_rate_limit_error_handlers(app):
        """设置限流错误处理器"""
        pass

    def init_rate_limit(app, use_redis=False, use_flask_limiter=False):
        """初始化限流"""
        return "simple"

    def get_rate_limit_stats():
        """获取限流统计"""
        return {}

    def log_rate_limit_event(client_ip, action, result):
        """记录限流事件"""
        logger.info(f"限流事件: {client_ip} - {action} - {result}")

# 创建Flask应用
app = Flask(__name__)

# ==================== CORS配置 ====================

def get_cors_origins():
    """获取CORS允许的源地址"""
    # 默认的CORS地址（开发环境常用地址）
    origins = [
        "http://localhost:3000",
        "http://localhost:31033",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:31033"
    ]
    
    # 从环境变量获取CORS_ORIGINS，支持多个地址用逗号分隔
    cors_origins_env = os.getenv('CORS_ORIGINS', '')
    
    if cors_origins_env:
        # 如果设置了环境变量，在默认地址基础上添加环境变量中的地址
        additional_origins = [origin.strip() for origin in cors_origins_env.split(',') if origin.strip()]
        origins.extend(additional_origins)
    
    # 去重并过滤空值
    origins = list(set([origin for origin in origins if origin]))
    
    logger.info(f"CORS允许的源地址: {origins}")
    return origins

# 配置CORS
CORS(app, 
     origins=get_cors_origins(),
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
     supports_credentials=True)

# ==================== 实时Job状态监听 ====================

# 存储所有SSE连接的客户端
sse_clients = set()

# 定时状态检查线程
status_check_thread = None
status_check_running = False

# 添加全局变量用于Informer机制
pod_cache = {}  # 本地Pod缓存
last_resource_version = None  # 资源版本控制
last_sync_time = 0  # 上次同步时间
sync_interval = 300  # 同步间隔（5分钟）

def notify_job_status_change(job_id: str, status: str, node_name: str = None):
    """通知所有SSE客户端Job状态变化"""
    global sse_clients
    
    message = {
        "type": "job_status_change",
        "job_id": job_id,
        "status": status,
        "node_name": node_name,
        "timestamp": time.time()
    }
    
    logger.info(f"准备通知SSE客户端: {message}")
    
    if not sse_clients:
        logger.warning("没有SSE客户端连接，无法发送状态更新")
        return
    
    # 移除断开的连接
    disconnected_clients = set()
    for client in sse_clients:
        try:
            client.put(f"data: {json.dumps(message)}\n\n")
            logger.debug(f"已发送状态更新到SSE客户端: {job_id} -> {status}")
        except Exception as e:
            logger.warning(f"发送状态更新到SSE客户端失败: {e}")
            disconnected_clients.add(client)
    
    # 清理断开的连接
    sse_clients -= disconnected_clients
    if disconnected_clients:
        logger.info(f"清理了 {len(disconnected_clients)} 个断开的SSE连接")
    
    logger.info(f"成功通知 {len(sse_clients) - len(disconnected_clients)} 个SSE客户端Job状态变化")

def notify_diagnostic_results_update():
    """通知SSE客户端诊断结果已更新"""
    global sse_clients
    
    message = {
        "type": "diagnostic_results_updated",
        "message": "诊断结果已更新，请刷新查看",
        "timestamp": time.time()
    }
    
    logger.info("准备通知SSE客户端诊断结果已更新")
    
    if not sse_clients:
        logger.warning("没有SSE客户端连接，无法发送诊断结果更新通知")
        return
    
    # 移除断开的连接
    disconnected_clients = set()
    for client in sse_clients:
        try:
            client.put(f"data: {json.dumps(message)}\n\n")
            logger.debug(f"已发送诊断结果更新通知到SSE客户端")
        except Exception as e:
            logger.warning(f"发送诊断结果更新通知到SSE客户端失败: {e}")
            disconnected_clients.add(client)
    
    # 清理断开的连接
    sse_clients -= disconnected_clients
    if disconnected_clients:
        logger.info(f"清理了 {len(disconnected_clients)} 个断开的SSE连接")
    
    logger.info(f"成功通知 {len(sse_clients) - len(disconnected_clients)} 个SSE客户端诊断结果已更新")

def get_kubernetes_job_status(job_id: str):
    """获取Kubernetes Job的实时状态"""
    try:
        # 首先查找所有匹配的Job（因为一个job_id可能对应多个节点的Job）
        # 尝试多种标签选择器
        job_found = False
        jobs = []
        
        # 策略1: 使用job-id标签
        result = subprocess.run([
            'kubectl', 'get', 'jobs', '-n', 'gpu-health-expert', 
            '-l', f'job-id={job_id}', '-o', 'json'
        ], capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            jobs_data = json.loads(result.stdout)
            jobs = jobs_data.get('items', [])
            if jobs:
                logger.info(f"通过job-id标签找到 {len(jobs)} 个Job")
                job_found = True
        
        # 策略2: 如果策略1失败，尝试通过Job名称模式查找
        if not job_found:
            logger.info(f"通过job-id标签未找到Job，尝试通过名称模式查找: {job_id}")
            result = subprocess.run([
                'kubectl', 'get', 'jobs', '-n', 'gpu-health-expert', 
                '-o', 'json'
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                all_jobs_data = json.loads(result.stdout)
                all_jobs = all_jobs_data.get('items', [])
                
                # 查找名称包含job_id的Job
                for job in all_jobs:
                    job_name = job.get('metadata', {}).get('name', '')
                    if job_id in job_name:
                        jobs.append(job)
                        logger.info(f"通过名称模式找到Job: {job_name}")
                
                if jobs:
                    job_found = True
                    logger.info(f"通过名称模式找到 {len(jobs)} 个Job")
        
        if not job_found:
            logger.warning(f"未找到匹配的Job: job-id={job_id}")
            return None
        
        # 合并所有Job的状态
        total_completions = 0
        total_failed = 0
        total_active = 0
        all_pod_statuses = []
        
        for job in jobs:
            job_status = job.get('status', {})
            total_completions += job_status.get('succeeded', 0)
            total_failed += job_status.get('failed', 0)
            total_active += job_status.get('active', 0)
            
            # 获取每个Job的Pod状态
            job_name = job.get('metadata', {}).get('name', '')
            if job_name:
                try:
                    pod_result = subprocess.run([
                        'kubectl', 'get', 'pods', '-n', 'gpu-health-expert', 
                        '-l', f'job-name={job_name}', '-o', 'json'
                    ], capture_output=True, text=True, timeout=30)
                    
                    if pod_result.returncode == 0:
                        pods_data = json.loads(pod_result.stdout)
                        pods = pods_data.get('items', [])
                        
                        for pod in pods:
                            pod_phase = pod.get('status', {}).get('phase', 'Unknown')
                            container_statuses = pod.get('status', {}).get('containerStatuses', [])
                            
                            logger.info(f"Pod {pod.get('metadata', {}).get('name', 'unknown')} 状态分析:")
                            logger.info(f"  - pod_phase: {pod_phase}")
                            logger.info(f"  - container_statuses: {len(container_statuses)} 个容器")
                            
                            # 首先检查容器状态，因为它更准确反映实际运行状态
                            if container_statuses:
                                container_status = container_statuses[0]
                                container_state = container_status.get('state', {})
                                logger.info(f"  - container_state: {container_state}")
                                
                                if container_state.get('running'):
                                    all_pod_statuses.append('Running')
                                    logger.info(f"  - 检测到Running状态 (来自container_state)")
                                elif container_state.get('terminated'):
                                    exit_code = container_state['terminated'].get('exitCode', 0)
                                    if exit_code == 0:
                                        all_pod_statuses.append('Completed')
                                        logger.info(f"  - 检测到Completed状态 (来自container_state)")
                                    else:
                                        reason = container_state['terminated'].get('reason', 'Error')
                                        all_pod_statuses.append(f'Failed: {reason}')
                                        logger.info(f"  - 检测到Failed状态 (来自container_state): {reason}")
                                elif container_state.get('waiting'):
                                    reason = container_state['waiting'].get('reason', 'Waiting')
                                    all_pod_statuses.append(f'Waiting: {reason}')
                                    logger.info(f"  - 检测到Waiting状态 (来自container_state): {reason}")
                                else:
                                    # 如果没有明确的容器状态，使用pod_phase
                                    if pod_phase == 'Running':
                                        all_pod_statuses.append('Running')
                                        logger.info(f"  - 检测到Running状态 (来自pod_phase)")
                                    elif pod_phase == 'Completed':
                                        all_pod_statuses.append('Completed')
                                        logger.info(f"  - 检测到Completed状态 (来自pod_phase)")
                                    elif pod_phase == 'Failed':
                                        all_pod_statuses.append('Failed')
                                        logger.info(f"  - 检测到Failed状态 (来自pod_phase)")
                                    else:
                                        all_pod_statuses.append(pod_phase)
                                        logger.info(f"  - 使用pod_phase: {pod_phase}")
                            else:
                                # 没有容器状态，使用pod_phase
                                if pod_phase == 'Running':
                                    all_pod_statuses.append('Running')
                                    logger.info(f"  - 检测到Running状态 (来自pod_phase)")
                                elif pod_phase == 'Completed':
                                    all_pod_statuses.append('Completed')
                                    logger.info(f"  - 检测到Completed状态 (来自pod_phase)")
                                elif pod_phase == 'Failed':
                                    all_pod_statuses.append('Failed')
                                    logger.info(f"  - 检测到Failed状态 (来自pod_phase)")
                                elif pod_phase == 'Pending':
                                    all_pod_statuses.append('Pending')
                                    logger.info(f"  - 检测到Pending状态 (来自pod_phase)")
                                else:
                                    all_pod_statuses.append(pod_phase)
                                    logger.info(f"  - 使用pod_phase: {pod_phase}")
                                    
                                # 额外检查：如果pod_phase是Running但容器状态为空，可能是容器刚启动
                                if pod_phase == 'Running' and not container_statuses:
                                    logger.info(f"  - Pod状态为Running但容器状态为空，可能是容器刚启动")
                                    all_pod_statuses.append('Running')
                                
                except Exception as e:
                    logger.warning(f"获取Pod状态失败: {e}")
        
        # 确定整体状态
        if total_failed > 0:
            status = 'Failed'
        elif total_completions > 0 and total_active == 0:
            status = 'Completed'
        elif total_active > 0:
            status = 'Running'
        else:
            status = 'Pending'
        
        # 确定Pod状态 - 优先使用Pod的实际状态
        if not all_pod_statuses:
            pod_status = 'Unknown'
        else:
            # 统计各种状态的数量
            running_count = sum(1 for s in all_pod_statuses if 'Running' in s)
            completed_count = sum(1 for s in all_pod_statuses if 'Completed' in s)
            failed_count = sum(1 for s in all_pod_statuses if 'Failed' in s)
            waiting_count = sum(1 for s in all_pod_statuses if 'Waiting' in s)
            pending_count = sum(1 for s in all_pod_statuses if s == 'Pending')
            
            logger.info(f"Pod状态统计: Running={running_count}, Completed={completed_count}, Failed={failed_count}, Waiting={waiting_count}, Pending={pending_count}")
            
            if failed_count > 0:
                pod_status = 'Failed'
            elif completed_count > 0 and running_count == 0 and waiting_count == 0 and pending_count == 0:
                pod_status = 'Completed'
            elif running_count > 0:
                pod_status = 'Running'
            elif waiting_count > 0 or pending_count > 0:
                pod_status = 'Pending'  # 统一使用Pending状态
            else:
                pod_status = 'Unknown'
        
        logger.info(f"Job {job_id} 最终状态: {status}, Pod状态: {pod_status}")
        logger.info(f"Job统计: completions={total_completions}, failed={total_failed}, active={total_active}")
        logger.info(f"Pod状态列表: {all_pod_statuses}")
        
        return {
            'pod_status': pod_status,
            'job_status': status,
            'total_completions': total_completions,
            'total_failed': total_failed,
            'total_active': total_active,
            'all_pod_statuses': all_pod_statuses
        }
        
    except Exception as e:
        logger.error(f"获取Kubernetes Job状态失败: {e}")
        return None

def extract_job_id_from_pod_name(pod_name):
    """从Pod名称中提取job_id"""
    try:
        # Pod名称格式: ghx-manual-job-{job_id}-{node_name}-{random_suffix}
        # 例如: ghx-manual-job-manual-1756721527-21039310-hd03-gpu2-0062-mdtlt
        parts = pod_name.split('-')
        if len(parts) >= 7:  # ghx, manual, job, manual, timestamp, random_id, node_name, ...
            # 提取job_id部分: manual-1756721527-21039310
            job_id_parts = parts[3:6]  # manual, timestamp, random_id
            job_id = '-'.join(job_id_parts)
            return job_id
        return None
    except Exception as e:
        logger.warning(f"从Pod名称提取job_id失败: {pod_name}, 错误: {e}")
        return None

def convert_kubectl_status_to_standard(kubectl_status, ready):
    """将kubectl状态转换为标准状态"""
    status = kubectl_status.lower()
    
    # 映射kubectl状态到标准状态
    status_mapping = {
        'pending': 'Pending',
        'running': 'Running',
        'succeeded': 'Completed',
        'failed': 'Failed',
        'unknown': 'Unknown',
        'crashloopbackoff': 'Failed',
        'error': 'Failed',
        'completed': 'Completed'
    }
    
    # 检查ready状态
    if ready and '/' in ready:
        ready_parts = ready.split('/')
        if len(ready_parts) == 2:
            ready_count = int(ready_parts[0])
            total_count = int(ready_parts[1])
            # 如果所有容器都ready且状态是running，则认为是Running
            if ready_count == total_count and status == 'running':
                return 'Running'
            # 如果部分ready且状态是running，则认为是Running（容器启动中）
            elif ready_count > 0 and status == 'running':
                return 'Running'
    
    # 返回映射的状态，如果没有映射则返回原状态
    return status_mapping.get(status, kubectl_status)

def get_job_from_db(job_id):
    """从数据库中获取Job信息"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM diagnostic_jobs WHERE job_id = ?', (job_id,))
        job = cursor.fetchone()
        conn.close()
        
        if job:
            return {
                'job_id': job[1],  # job_id
                'status': job[7],  # status
                'node_name': job[4],  # selected_nodes (作为node_name)
                'created_at': job[8],  # created_at
                'updated_at': job[9]  # updated_at
            }
        return None
    except Exception as e:
        logger.warning(f"从数据库获取Job失败: {e}")
        return None

def get_pod_cache_key(pod_name):
    """生成Pod缓存键"""
    return pod_name

def update_pod_cache(pod_name, pod_data):
    """更新Pod缓存"""
    global pod_cache
    cache_key = get_pod_cache_key(pod_name)
    pod_cache[cache_key] = {
        'data': pod_data,
        'timestamp': time.time(),
        'resource_version': pod_data.metadata.resource_version if hasattr(pod_data.metadata, 'resource_version') else None
    }

def get_pod_from_cache(pod_name):
    """从缓存获取Pod数据"""
    global pod_cache
    cache_key = get_pod_cache_key(pod_name)
    return pod_cache.get(cache_key)

def sync_pod_cache_from_api():
    """从API同步Pod缓存（定期全量同步）"""
    global last_sync_time, last_resource_version, pod_cache
    
    try:
        if not kubernetes_client:
            logger.warning("Kubernetes客户端不可用，跳过缓存同步")
            return
        
        v1, batch_v1 = kubernetes_client
        current_time = time.time()
        
        # 检查是否需要同步
        if current_time - last_sync_time < sync_interval:
            return
        
        logger.info("开始定期同步Pod缓存...")
        
        # 获取所有相关Pod
        pods = v1.list_namespaced_pod(
            namespace='gpu-health-expert',
            label_selector='app=ghx-manual,job-type=manual'
        )
        
        # 更新缓存
        new_cache = {}
        for pod in pods.items:
            cache_key = get_pod_cache_key(pod.metadata.name)
            new_cache[cache_key] = {
                'data': pod,
                'timestamp': current_time,
                'resource_version': pod.metadata.resource_version if hasattr(pod.metadata, 'resource_version') else None
            }
        
        # 检查缓存变化
        cache_changes = []
        for pod_name, pod_info in new_cache.items():
            old_pod_info = pod_cache.get(pod_name)
            if not old_pod_info or old_pod_info['resource_version'] != pod_info['resource_version']:
                cache_changes.append(pod_name)
        
        # 更新全局缓存
        pod_cache = new_cache
        last_sync_time = current_time
        
        if pods.metadata and hasattr(pods.metadata, 'resource_version'):
            last_resource_version = pods.metadata.resource_version
        
        logger.info(f"Pod缓存同步完成，共 {len(new_cache)} 个Pod，{len(cache_changes)} 个变化")
        
    except Exception as e:
        logger.error(f"同步Pod缓存失败: {e}")

def handle_pod_status_change(pod):
    """处理Pod状态变化（Informer风格）"""
    try:
        pod_name = pod.metadata.name
        pod_status = pod.status.phase if pod.status else 'Unknown'
        
        # 从Pod名称中提取job_id
        job_id = extract_job_id_from_pod_name(pod_name)
        if not job_id:
            logger.debug(f"无法从Pod名称提取job_id: {pod_name}")
            return
        
        # 检查数据库中是否存在这个Job
        db_job = get_job_from_db(job_id)
        if not db_job:
            logger.debug(f"数据库中不存在Job: {job_id}")
            return
        
        # 转换状态格式 - 将Pod状态转换为小写后传给转换函数
        pod_status_standard = convert_kubectl_status_to_standard(pod_status.lower(), "1/1" if pod_status == "Running" else "0/1")
        
        # 检查状态是否有变化 - 统一转换为小写进行比较
        if pod_status_standard.lower() != db_job['status'].lower():
            logger.info(f"🔄 Pod状态变化: {job_id} {db_job['status']} -> {pod_status_standard}")
            
            # 更新数据库状态
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE diagnostic_jobs 
                SET status = ?, updated_at = datetime('now', 'localtime')
                WHERE job_id = ?
            ''', (pod_status_standard, job_id))
            conn.commit()
            conn.close()
            
            # 通知SSE客户端
            notify_job_status_change(job_id, pod_status_standard, db_job['node_name'] if 'node_name' in db_job.keys() else None)
            
            # 如果Pod完成，处理结果收集
            if pod_status_standard in ['Succeeded', 'Failed', 'Completed']:
                handle_job_completion(job_id)
        else:
            logger.debug(f"Pod {pod_name} 状态无变化: {pod_status_standard}")
            
    except Exception as e:
        logger.warning(f"处理Pod状态变化失败: {e}")

def pod_status_callback(event):
    """Pod状态变化回调函数（Informer风格）"""
    try:
        event_type = event['type']
        pod = event['object']
        pod_name = pod.metadata.name
        
        logger.info(f"🔄 收到Pod事件: {event_type} - {pod_name}")
        
        # 更新本地缓存
        update_pod_cache(pod_name, pod)
        
        # 根据事件类型处理
        if event_type == 'MODIFIED':
            handle_pod_status_change(pod)
        elif event_type == 'ADDED':
            logger.info(f"新增Pod: {pod_name}")
            handle_pod_status_change(pod)
        elif event_type == 'DELETED':
            logger.info(f"删除Pod: {pod_name}")
            # 从缓存中移除
            cache_key = get_pod_cache_key(pod_name)
            if cache_key in pod_cache:
                del pod_cache[cache_key]
        
    except Exception as e:
        logger.warning(f"处理Watch事件失败: {e}")

def start_kubernetes_watch_thread():
    """启动Kubernetes Watch线程（基于Informer机制优化）"""
    global status_check_thread, status_check_running, last_resource_version
    
    if status_check_running:
        logger.info("状态检查线程已在运行中")
        return
    
    logger.info("正在启动Kubernetes Watch线程（Informer优化版）...")
    status_check_running = True
    
    def kubernetes_watch_worker():
        """Kubernetes Watch工作线程（Informer风格）"""
        global last_resource_version
        
        thread_id = threading.current_thread().ident
        logger.info(f"Kubernetes Watch工作线程已启动 (线程ID: {thread_id})")
        
        v1, batch_v1 = kubernetes_client
        retry_count = 0
        max_retries = 10  # 最大重试次数
        
        # 初始化时进行全量同步
        sync_pod_cache_from_api()
        
        while status_check_running:
            try:
                # 定期同步缓存
                sync_pod_cache_from_api()
                
                # 构建Watch参数
                watch_params = {
                    'namespace': 'gpu-health-expert',
                    'label_selector': 'app=ghx-manual,job-type=manual'
                }
                
                # 如果有资源版本，从该版本开始Watch
                if last_resource_version:
                    watch_params['resource_version'] = last_resource_version
                    logger.info(f"从资源版本 {last_resource_version} 开始Watch")
                
                # 创建Watch对象
                from kubernetes import watch
                w = watch.Watch()
                
                # 开始Watch流
                for event in w.stream(v1.list_namespaced_pod, **watch_params):
                    if not status_check_running:
                        logger.info("收到停止信号，终止Watch")
                        break
                    
                    # 更新资源版本
                    if hasattr(event['object'].metadata, 'resource_version'):
                        last_resource_version = event['object'].metadata.resource_version
                    
                    # 调用回调函数处理事件
                    pod_status_callback(event)
                
                # Watch流结束（通常是网络问题或超时）
                logger.info("Kubernetes Watch流结束，准备重新启动...")
                w.stop()
                
                # 短暂等待后重新启动Watch
                if status_check_running:
                    logger.info("5秒后重新启动Watch...")
                    time.sleep(5)
                
            except Exception as e:
                retry_count += 1
                logger.error(f"Kubernetes Watch异常 (重试 {retry_count}/{max_retries}): {e}")
                
                if retry_count >= max_retries:
                    logger.error(f"Watch重试次数达到上限，回退到kubectl watch模式...")
                    start_kubectl_watch_thread()
                    break
                
                # 指数退避：1秒, 2秒, 4秒, 8秒, 16秒...
                wait_time = min(2 ** retry_count, 30)  # 最大等待30秒
                logger.info(f"{wait_time}秒后重试Watch...")
                try:
                    w.stop()
                except:
                    pass
                time.sleep(wait_time)
                continue  # 继续循环，重试Watch
        
        logger.info(f"Kubernetes Watch工作线程已退出 (线程ID: {thread_id})")
    
    # 启动线程
    status_check_thread = threading.Thread(target=kubernetes_watch_worker, daemon=True)
    status_check_thread.start()
    time.sleep(0.1)
    
    if status_check_thread.is_alive():
        logger.info(f"Kubernetes Watch线程已成功启动 (线程ID: {status_check_thread.ident})")
    else:
        logger.error("Kubernetes Watch线程启动失败")
        status_check_running = False

def start_kubectl_watch_thread():
    """启动kubectl watch Pod监听线程"""
    global status_check_thread, status_check_running
    
    if status_check_running:
        logger.info("状态检查线程已在运行中")
        return
    
    logger.info("正在启动kubectl watch Pod监听线程...")
    status_check_running = True
    
    def kubectl_watch_worker():
        """kubectl watch工作线程"""
        thread_id = threading.current_thread().ident
        logger.info(f"kubectl watch工作线程已启动 (线程ID: {thread_id})")
        
        retry_count = 0
        max_retries = 10  # 最大重试次数
        
        while status_check_running:
            try:
                # 使用kubectl watch监听Pod变化
                logger.info("开始使用kubectl watch监听gpu-health-expert命名空间的Pod变化...")
                
                # 构建kubectl get --watch命令
                cmd = [
                    'kubectl', 'get', 'pods', '-n', 'gpu-health-expert',
                    '-l', 'app=ghx-manual,job-type=manual',
                    '--no-headers', '--watch'
                ]
                
                logger.info(f"执行kubectl watch命令: {' '.join(cmd)}")
                
                # 启动kubectl watch进程
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )
                
                logger.info(f"kubectl watch进程已启动 (PID: {process.pid})")
                
                # 读取输出
                for line in iter(process.stdout.readline, ''):
                    if not status_check_running:
                        logger.info("收到停止信号，终止kubectl watch")
                        break
                    
                    if line.strip():
                        try:
                            # 解析kubectl watch输出
                            # 格式: NAME READY STATUS RESTARTS AGE
                            # 例如: ghx-manual-job-xxx-yyy-zzz 0/1 Pending 0 5s
                            parts = line.strip().split()
                            if len(parts) >= 4:
                                pod_name = parts[0]
                                ready = parts[1]  # 例如: 0/1
                                status = parts[2]  # 例如: Pending, Running, Completed, Failed
                                restarts = parts[3]
                                
                                logger.info(f"🔄 kubectl watch检测到Pod变化: {pod_name} -> {status} (Ready: {ready}, Restarts: {restarts})")
                                
                                # 从Pod名称中提取job_id
                                job_id = extract_job_id_from_pod_name(pod_name)
                                if not job_id:
                                    logger.debug(f"无法从Pod名称提取job_id: {pod_name}")
                                    continue
                                
                                # 检查数据库中是否存在这个Job
                                db_job = get_job_from_db(job_id)
                                if not db_job:
                                    logger.debug(f"数据库中不存在Job: {job_id}")
                                    continue
                                
                                # 转换状态格式 - 将kubectl状态转换为小写后传给转换函数
                                pod_status = convert_kubectl_status_to_standard(status.lower(), ready)
                                
                                # 检查状态是否有变化 - 统一转换为小写进行比较
                                if pod_status.lower() != db_job['status'].lower():
                                    logger.info(f"🔄 Pod状态变化: {job_id} {db_job['status']} -> {pod_status}")
                                    
                                    # 更新数据库状态
                                    conn = get_db_connection()
                                    cursor = conn.cursor()
                                    cursor.execute('''
                                        UPDATE diagnostic_jobs 
                                        SET status = ?, updated_at = datetime('now', 'localtime')
                                        WHERE job_id = ?
                                    ''', (pod_status, job_id))
                                    conn.commit()
                                    conn.close()
                                    
                                    # 通知SSE客户端
                                    notify_job_status_change(job_id, pod_status, db_job['node_name'] if 'node_name' in db_job.keys() else None)
                                    
                                    # 如果Pod完成，处理结果收集
                                    if pod_status in ['Succeeded', 'Failed', 'Completed']:
                                        handle_job_completion(job_id)
                                else:
                                    logger.debug(f"Pod {pod_name} 状态无变化: {pod_status}")
                            
                        except Exception as e:
                            logger.warning(f"解析kubectl watch输出失败: {e}, 原始行: {line.strip()}")
                            continue
                
                # 检查进程是否异常退出
                if process.poll() is not None:
                    stderr_output = process.stderr.read()
                    if stderr_output:
                        logger.warning(f"kubectl watch进程异常退出: {stderr_output}")
                    else:
                        logger.info("kubectl watch进程正常退出")
                
                # 清理进程
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                except Exception as e:
                    logger.warning(f"清理kubectl watch进程失败: {e}")
                
                if not status_check_running:
                    break
                
                # 等待一段时间后重新启动
                logger.info("kubectl watch连接断开，5秒后重新启动...")
                time.sleep(5)
                
            except Exception as e:
                retry_count += 1
                logger.error(f"kubectl watch异常 (重试 {retry_count}/{max_retries}): {e}")
                
                if retry_count >= max_retries:
                    logger.error(f"kubectl watch重试次数达到上限，回退到定时轮询模式...")
                    start_polling_status_check_thread()
                    break
                
                # 指数退避：1秒, 2秒, 4秒, 8秒, 16秒...
                wait_time = min(2 ** retry_count, 30)  # 最大等待30秒
                logger.info(f"{wait_time}秒后重试kubectl watch...")
                time.sleep(wait_time)
        
        logger.info(f"kubectl watch工作线程已退出 (线程ID: {thread_id})")
    
    # 启动线程
    status_check_thread = threading.Thread(target=kubectl_watch_worker, daemon=True)
    status_check_thread.start()
    time.sleep(0.1)
    
    if status_check_thread.is_alive():
        logger.info(f"kubectl watch线程已成功启动 (线程ID: {status_check_thread.ident})")
    else:
        logger.error("kubectl watch线程启动失败")
        status_check_running = False

def start_status_check_thread():
    """启动状态检查线程（多方案备选）"""
    global status_check_thread, status_check_running
    
    if status_check_running:
        logger.info("状态检查线程已在运行中")
        return
    
    # 添加调试信息
    logger.info(f"kubernetes_client: {kubernetes_client}")
    
    # 优先尝试Kubernetes客户端Watch
    if kubernetes_client:
        logger.info("正在启动Kubernetes Watch状态检查线程...")
        start_kubernetes_watch_thread()
    else:
        logger.warning("Kubernetes客户端不可用，尝试使用kubectl watch...")
        start_kubectl_watch_thread()
        
        # 如果kubectl watch也失败，回退到轮询模式
        if not status_check_running:
            logger.warning("kubectl watch启动失败，回退到定时轮询模式")
            start_polling_status_check_thread()

def start_polling_status_check_thread():
    """启动定时轮询状态检查线程（回退方案）"""
    global status_check_thread, status_check_running
    
    logger.info("正在启动定时轮询状态检查线程...")
    status_check_running = True
    
    def polling_status_check_worker():
        """定时轮询工作线程"""
        thread_id = threading.current_thread().ident
        logger.info(f"定时轮询工作线程已启动 (线程ID: {thread_id})")
        
        while status_check_running:
            try:
                # 每10秒检查一次活跃Job的状态
                time.sleep(10)
                
                # 获取所有活跃Job
                conn = get_db_connection()
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT job_id, status FROM diagnostic_jobs 
                    WHERE status IN ('pending', 'running', 'Pending', 'Running', 'unknown', 'Unknown')
                    OR status LIKE '%pending%' OR status LIKE '%running%'
                    OR status LIKE '%waiting%' OR status LIKE '%creating%'
                    OR status LIKE '%ContainerCreating%'
                ''')
                
                active_jobs = cursor.fetchall()
                conn.close()
                
                if active_jobs:
                    logger.info(f"定时检查: 找到 {len(active_jobs)} 个活跃Job")
                    
                    for job_id, current_status in active_jobs:
                        try:
                            # 获取最新的Kubernetes状态
                            k8s_status = get_kubernetes_job_status(job_id)
                            if k8s_status:
                                new_status = k8s_status['pod_status']
                                
                                # 标准化状态比较
                                current_normalized = current_status.lower().strip()
                                new_normalized = new_status.lower().strip()
                                
                                if current_normalized != new_normalized:
                                    logger.info(f"🔄 状态变化: {job_id} {current_status} -> {new_status}")
                                    
                                    # 通知前端状态变化
                                    notify_job_status_change(job_id, new_status)
                                    
                                    # 更新数据库中的状态
                                    try:
                                        conn = get_db_connection()
                                        cursor = conn.cursor()
                                        cursor.execute('''
                                            UPDATE diagnostic_jobs 
                                            SET status = ?, updated_at = datetime('now', 'localtime')
                                            WHERE job_id = ?
                                        ''', (new_status, job_id))
                                        conn.commit()
                                        conn.close()
                                    except Exception as db_error:
                                        logger.warning(f"❌ 更新数据库失败: {db_error}")
                                    
                                    # 如果Job已完成，自动触发诊断结果入库
                                    if new_status in ['Completed', 'Succeeded', 'Failed']:
                                        handle_job_completion(job_id)
                            else:
                                # 如果无法获取Kubernetes状态，说明Job可能已被删除
                                new_status = 'unknown'
                                logger.warning(f"无法获取Job {job_id} 的Kubernetes状态，设为unknown")
                                
                                # 通知前端状态变化
                                notify_job_status_change(job_id, new_status)
                                
                                # 更新数据库中的状态
                                try:
                                    conn = get_db_connection()
                                    cursor = conn.cursor()
                                    cursor.execute('''
                                        UPDATE diagnostic_jobs 
                                        SET status = ?, updated_at = datetime('now', 'localtime')
                                        WHERE job_id = ?
                                    ''', (new_status, job_id))
                                    conn.commit()
                                    conn.close()
                                except Exception as db_error:
                                    logger.warning(f"❌ 更新数据库失败: {db_error}")
                        except Exception as e:
                            logger.warning(f"检查Job {job_id} 状态失败: {e}")
                else:
                    logger.debug("没有活跃Job需要检查")
                    # 没有活跃Job时，减少检查频率
                    time.sleep(30)  # 等待30秒再检查
                    continue
                
                logger.info(f"定时状态检查完成，检查了 {len(active_jobs)} 个活跃Job")
                
            except Exception as e:
                logger.error(f"定时状态检查异常: {e}")
                time.sleep(60)  # 出错时等待更长时间
        
        logger.info(f"定时轮询工作线程已退出 (线程ID: {thread_id})")
    
    # 启动线程
    status_check_thread = threading.Thread(target=polling_status_check_worker, daemon=True)
    status_check_thread.start()
    time.sleep(0.1)
    
    if status_check_thread.is_alive():
        logger.info(f"定时轮询状态检查线程已成功启动 (线程ID: {status_check_thread.ident})")
    else:
        logger.error("定时轮询状态检查线程启动失败")
        status_check_running = False

def handle_job_completion(job_id: str):
    """处理Job完成后的操作（在后台线程中安全调用）"""
    try:
        logger.info(f"开始处理Job完成: {job_id}")
        
        # 从PVC读取manual类型的文件
        pvc_path = '/shared/gpu-inspection-results/manual'
        if not os.path.exists(pvc_path):
            return {"success": False, "error": "PVC路径不存在"}
        
        # 获取Job信息，了解涉及哪些节点
        db_job = get_job_from_db(job_id)
        if db_job and 'node_name' in db_job.keys() and db_job['node_name']:
            try:
                # 解析节点名称（JSON格式的字符串）
                node_names = json.loads(db_job['node_name'])
                logger.info(f"Job涉及节点: {node_names}")
            except:
                node_names = [db_job['node_name']]
        else:
            node_names = []
        
        # 等待所有节点的文件生成完成（最多等待60秒）
        max_wait_time = 60  # 秒
        wait_interval = 5   # 秒
        total_wait_time = 0
        
        while total_wait_time < max_wait_time:
            # 直接查找所有manual文件
            pattern = f"{pvc_path}/*.json"
            json_files = glob.glob(pattern)
            
            # 检查是否所有节点的文件都已生成
            if node_names:
                expected_files = []
                nodes_with_files = set()
                for node_name in node_names:
                    # 检查是否有该节点的所有文件（包括带时间戳的和latest文件）
                    node_pattern = f"{pvc_path}/{node_name}_*.json"
                    node_files = glob.glob(node_pattern)
                    if node_files:
                        expected_files.extend(node_files)
                        nodes_with_files.add(node_name)
                
                logger.info(f"当前找到文件: {len(json_files)} 个，期望节点文件: {len(expected_files)} 个")
                logger.info(f"有文件的节点: {list(nodes_with_files)}，总节点: {node_names}")
                
                # 如果所有节点的文件都已生成，或者等待时间已到，则开始处理
                if len(nodes_with_files) >= len(node_names) or total_wait_time >= max_wait_time - wait_interval:
                    json_files = expected_files
                    break
                else:
                    logger.info(f"等待所有节点文件生成完成，已等待 {total_wait_time} 秒...")
                    time.sleep(wait_interval)
                    total_wait_time += wait_interval
                    continue
            else:
                # 如果没有节点信息，直接处理现有文件
                break
        
        if not json_files:
            return {"success": False, "error": "未找到任何manual结果文件"}
        
        logger.info(f"开始处理 {len(json_files)} 个文件")
        logger.info(f"文件列表: {json_files}")
        
        processed_count = 0
        for file_path in json_files:
            try:
                logger.info(f"开始处理文件: {file_path}")
                
                # 检查文件是否已经处理过
                is_processed = collector.is_manual_file_processed(file_path)
                logger.info(f"检查文件处理状态: {file_path} -> 已处理: {is_processed}")
                if is_processed:
                    logger.info(f"文件已处理过，跳过: {file_path}")
                    continue
                
                # 读取JSON文件
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # 验证数据格式
                if collector.validate_manual_result_data(data):
                    # 保存到数据库
                    collector.save_manual_diagnostic_result(data, file_path)
                    processed_count += 1
                    logger.info(f"成功处理manual文件: {file_path}")
                else:
                    logger.warning(f"manual数据格式无效，跳过文件: {file_path}")
                    
            except Exception as e:
                logger.error(f"处理manual文件 {file_path} 失败: {e}")
                continue
        
        # 处理完成后通知前端更新
        if processed_count > 0:
            notify_diagnostic_results_update()
        
        return {
            "success": True,
            "message": f"成功处理 {processed_count} 个manual结果文件",
            "processedCount": processed_count,
            "totalFiles": len(json_files)
        }
                
    except Exception as e:
        logger.error(f"处理Job完成失败: {e}")
        return {
            "success": False,
            "error": f"处理Job完成失败: {str(e)}"
        }

def stop_status_check_thread():
    """停止定时状态检查线程"""
    global status_check_running
    status_check_running = False
    if status_check_thread:
        status_check_thread.join(timeout=5)
    logger.info("定时状态检查线程已停止")

# 数据库配置
DB_PATH = '/shared/gpu_inspection.db'
SHARED_PVC_PATH = '/shared/gpu-inspection-results/cron'

def get_db_connection():
    """获取数据库连接"""
    try:
        # 确保数据库目录存在
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row  # 使结果可以通过列名访问
        return conn
    except Exception as e:
        logger.error(f"数据库连接失败: {e}")
        raise

def init_db():
    """初始化数据库表结构"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 创建GPU检查结果表（来自gpu_collector_service）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS gpu_inspections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hostname TEXT NOT NULL,
                node_name TEXT,
                pod_name TEXT,
                gpu_type TEXT,
                bandwidth_test TEXT,
                p2p_bandwidth_latency_test TEXT,
                nccl_tests TEXT,
                dcgm_diag TEXT,
                ib_check TEXT,
                inspection_result TEXT,
                timestamp TEXT,
                execution_time TEXT,
                execution_log TEXT,
                benchmark TEXT,
                created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime'))
            )
        ''')
        
        # 创建诊断结果表（来自gpu_cli）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS diagnostic_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                job_type TEXT NOT NULL DEFAULT 'manual',
                node_name TEXT NOT NULL,
                gpu_type TEXT,
                enabled_tests TEXT,
                dcgm_level INTEGER DEFAULT 1,
                inspection_result TEXT,
                performance_pass BOOLEAN,
                health_pass BOOLEAN,
                execution_time TEXT,
                execution_log TEXT,
                benchmark_data TEXT,
                test_results TEXT,
                file_path TEXT,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                updated_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                UNIQUE(job_id, node_name)
            )
        ''')
        
        # 创建Job状态表（来自gpu_cli）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS diagnostic_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL UNIQUE,
                job_name TEXT NOT NULL,
                job_type TEXT NOT NULL DEFAULT 'manual',
                selected_nodes TEXT,
                enabled_tests TEXT,
                dcgm_level INTEGER DEFAULT 1,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                updated_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                error_message TEXT,
                expires_at TIMESTAMP
            )
        ''')
        
        # 创建索引
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_gpu_inspections_hostname 
            ON gpu_inspections(hostname)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_gpu_inspections_created_at 
            ON gpu_inspections(created_at)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_diagnostic_results_job_id 
            ON diagnostic_results(job_id)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_diagnostic_results_created_at 
            ON diagnostic_results(created_at)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_job_id 
            ON diagnostic_jobs(job_id)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_status 
            ON diagnostic_jobs(status)
        ''')
        
        conn.commit()
        conn.close()
        
        logger.info("数据库初始化完成")
        
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}")
        raise

def safe_json_loads(json_str: str, default_value: Any = None) -> Any:
    """
    安全地解析JSON字符串，如果解析失败则返回默认值
    """
    if not json_str:
        return default_value
    
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning(f"JSON解析失败，尝试清理后重新解析: {e}")
        try:
            cleaned_str = json_str.strip()
            if cleaned_str.startswith('\ufeff'):
                cleaned_str = cleaned_str[1:]
            return json.loads(cleaned_str)
        except json.JSONDecodeError as e2:
            logger.error(f"清理后JSON解析仍然失败: {e2}")
            return default_value

# ============================================================================
# GPU数据收集器类 (来自gpu_collector_service)
# ============================================================================
class GPUDataCollector:
    def __init__(self):
        logger.info("=== GPUDataCollector初始化开始 ===")
        logger.info(f"SHARED_PVC_PATH: {SHARED_PVC_PATH}")
        self.init_database()
        logger.info("=== GPUDataCollector初始化完成 ===")
        
    def init_database(self):
        """初始化数据库"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # 创建检查结果表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS gpu_inspections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    hostname TEXT NOT NULL,
                    node_name TEXT,
                    pod_name TEXT,
                    gpu_type TEXT,
                    bandwidth_test TEXT,
                    p2p_bandwidth_latency_test TEXT,
                    nccl_tests TEXT,
                    dcgm_diag TEXT,
                    ib_check TEXT,
                    inspection_result TEXT,
                    timestamp TEXT,
                    execution_time TEXT,
                    execution_log TEXT,
                    benchmark TEXT,
                    performance_pass BOOLEAN,
                    raw_results TEXT,
                    file_path TEXT,
                    created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime'))
                )
            ''')
            
            # 检查是否需要添加新字段
            cursor.execute("PRAGMA table_info(gpu_inspections)")
            columns = [column[1] for column in cursor.fetchall()]
            
            if 'execution_time' not in columns:
                cursor.execute('ALTER TABLE gpu_inspections ADD COLUMN execution_time TEXT')
                logger.info("已添加execution_time字段")
            
            if 'execution_log' not in columns:
                cursor.execute('ALTER TABLE gpu_inspections ADD COLUMN execution_log TEXT')
                logger.info("已添加execution_log字段")
            
            # 创建索引
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_hostname ON gpu_inspections(hostname)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON gpu_inspections(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_result ON gpu_inspections(inspection_result)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_file_path ON gpu_inspections(file_path)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_execution_time ON gpu_inspections(execution_time)')
            
            # 创建诊断任务表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS diagnostic_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT UNIQUE NOT NULL,
                    job_name TEXT NOT NULL,
                    job_type TEXT NOT NULL DEFAULT 'manual',
                    selected_nodes TEXT NOT NULL,
                    enabled_tests TEXT NOT NULL,
                    dcgm_level INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    updated_at TIMESTAMP,
                    expires_at TIMESTAMP,
                    error_message TEXT
                )
            ''')
            
            # 创建诊断结果表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS diagnostic_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    job_type TEXT NOT NULL DEFAULT 'manual',
                    node_name TEXT NOT NULL,
                    gpu_type TEXT,
                    enabled_tests TEXT,
                    dcgm_level INTEGER,
                    inspection_result TEXT,
                    performance_pass BOOLEAN,
                    health_pass BOOLEAN,
                    execution_time TEXT,
                    execution_log TEXT,
                    benchmark_data TEXT,
                    test_results TEXT,
                    file_path TEXT,
                    created_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                    updated_at TIMESTAMP DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime')),
                    expires_at TIMESTAMP,
                    UNIQUE(job_id, node_name)
                )
            ''')
            
            # 创建诊断相关索引
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_job_id ON diagnostic_jobs(job_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_status ON diagnostic_jobs(status)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_jobs_created_at ON diagnostic_jobs(created_at)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_results_job_id ON diagnostic_results(job_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_results_node_name ON diagnostic_results(node_name)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostic_results_created_at ON diagnostic_results(created_at)')
            
            conn.commit()
            conn.close()
            logger.info("数据库初始化完成")
            
        except Exception as e:
            logger.error(f"数据库初始化失败: {e}")
    
    def cleanup_old_files(self, retention_days: int = 7):
        """清理超过 retention_days 的 JSON 文件和数据库记录"""
        try:
            # 清理文件
            if not os.path.exists(SHARED_PVC_PATH):
                logger.warning(f"共享PVC路径不存在: {SHARED_PVC_PATH}")
            else:
                now = time.time()
                pattern = f"{SHARED_PVC_PATH}/*.json"
                json_files = glob.glob(pattern)
                removed_count = 0
                for file_path in json_files:
                    try:
                        mtime = os.path.getmtime(file_path)
                        age_days = (now - mtime) / 86400
                        if age_days > retention_days:
                            os.remove(file_path)
                            removed_count += 1
                            logger.info(f"已删除过期文件: {file_path}")
                    except Exception as e:
                        logger.error(f"删除文件 {file_path} 失败: {e}")
                logger.info(f"清理完成，共删除 {removed_count} 个过期文件")

            # 清理数据库
            cutoff_time = datetime.now() - timedelta(days=retention_days)
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute('DELETE FROM gpu_inspections WHERE created_at < ?', (cutoff_time.isoformat(),))
                deleted_rows = cursor.rowcount
                conn.commit()
                conn.close()
                logger.info(f"清理数据库完成，共删除 {deleted_rows} 条过期记录")
            except Exception as e:
                logger.error(f"清理数据库过期记录失败: {e}")
        except Exception as e:
            logger.error(f"清理过期文件和数据库失败: {e}")
    
    def collect_from_shared_pvc(self):
        """从共享PVC中收集数据"""
        logger.info("=== 开始执行collect_from_shared_pvc函数 ===")
        try:
            if not os.path.exists(SHARED_PVC_PATH):
                logger.warning(f"共享PVC路径不存在: {SHARED_PVC_PATH}")
                return
            
            pattern = f"{SHARED_PVC_PATH}/*.json"
            json_files = glob.glob(pattern)
            logger.info(f"在PVC中找到 {len(json_files)} 个结果文件")
            
            for file_path in json_files:
                try:
                    if self.is_file_processed(file_path):
                        continue
                    
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    if self.validate_result_data(data):
                        self.save_inspection_result(data, file_path)
                        logger.info(f"成功处理文件: {file_path}")
                    else:
                        logger.warning(f"数据格式无效，跳过文件: {file_path}")
                        
                except Exception as e:
                    logger.error(f"处理文件 {file_path} 失败: {e}")
                    continue
                
        except Exception as e:
            logger.error(f"从共享PVC收集数据失败: {e}")
        finally:
            logger.info("=== collect_from_shared_pvc函数执行完成 ===")
    
    def collect_manual_results_from_pvc_internal(self):
        """内部函数：从PVC收集manual类型的诊断结果文件并入库"""
        try:
            # 从PVC读取manual类型的文件
            pvc_path = '/shared/gpu-inspection-results/manual'
            if not os.path.exists(pvc_path):
                return {"success": False, "error": "PVC路径不存在"}
            
            # 直接查找manual目录下的JSON文件
            pattern = f"{pvc_path}/*.json"
            json_files = glob.glob(pattern)
            
            logger.info(f"在manual PVC中找到 {len(json_files)} 个结果文件")
            if json_files:
                logger.info(f"找到的manual文件列表: {json_files}")
            
            processed_count = 0
            for file_path in json_files:
                try:
                    logger.info(f"开始处理manual文件: {file_path}")
                    # 检查文件是否已经处理过
                    if self.is_manual_file_processed(file_path):
                        logger.info(f"manual文件已处理过，跳过: {file_path}")
                        continue
                    
                    # 读取JSON文件
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    # 验证数据格式
                    if self.validate_manual_result_data(data):
                        # 保存到diagnostic_results表
                        self.save_manual_diagnostic_result(data, file_path)
                        processed_count += 1
                        logger.info(f"成功处理manual文件: {file_path}")
                    else:
                        logger.warning(f"manual数据格式无效，跳过文件: {file_path}")
                        
                except Exception as e:
                    logger.error(f"处理manual文件 {file_path} 失败: {e}")
                    continue
            
            logger.info(f"manual文件处理完成，共处理 {processed_count} 个文件")
            
            return {
                "success": True,
                "processedCount": processed_count,
                "totalFiles": len(json_files)
            }
            
        except Exception as e:
            logger.error(f"从PVC收集manual结果失败: {e}")
            return {
                "success": False,
                "error": f"从PVC收集manual结果失败: {str(e)}"
            }
    
    def is_file_processed(self, file_path: str) -> bool:
        """检查文件是否已经处理过"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) FROM gpu_inspections WHERE file_path = ?', (file_path,))
            count = cursor.fetchone()[0]
            conn.close()
            return count > 0
        except Exception as e:
            logger.error(f"检查文件处理状态失败: {e}")
            return False
    
    def is_manual_file_processed(self, file_path: str) -> bool:
        """检查manual文件是否已经处理过"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # 从文件路径中提取job_id（文件名格式：hd03-gpu2-0062_latest.json）
            filename = os.path.basename(file_path)
            if '_latest.json' in filename:
                # 对于latest文件，检查是否已经处理过
                # 从文件名中提取node_name
                node_name = filename.replace('_latest.json', '')
                
                # 检查该节点是否有任何诊断结果记录
                cursor.execute('SELECT COUNT(*) FROM diagnostic_results WHERE node_name = ?', (node_name,))
                count = cursor.fetchone()[0]
                
                conn.close()
                return count > 0
            else:
                # 对于带时间戳的文件，从文件名中提取job_id
                # 文件名格式: {node_name}_{timestamp}.json
                # 需要从文件名中提取job_id，这里简化处理
                # 假设文件名格式为: {job_id}-{node_name}.json
                job_id = filename.replace('.json', '').split('-')[0] + '-' + filename.replace('.json', '').split('-')[1]
                
                cursor.execute('SELECT COUNT(*) FROM diagnostic_results WHERE job_id = ?', (job_id,))
                count = cursor.fetchone()[0]
                
                conn.close()
                return count > 0
                        
        except Exception as e:
            logger.error(f"检查manual文件处理状态失败: {e}")
            return False
    
    def validate_manual_result_data(self, data: Dict[str, Any]) -> bool:
        """验证manual结果数据格式"""
        required_fields = ['job_id', 'node_name', 'gpu_type', 'test_results']
        
        for field in required_fields:
            if field not in data:
                logger.warning(f"数据格式不匹配，期望字段: {required_fields}")
                logger.warning(f"实际字段: {list(data.keys())}")
                return False
        
        return True
    
    def save_manual_diagnostic_result(self, data: Dict[str, Any], file_path: str):
        """保存manual诊断结果到数据库"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # 从数据中提取字段，如果不存在则使用默认值
            job_id = data['job_id']
            node_name = data['node_name']
            gpu_type = data.get('gpu_type', 'Unknown')
            enabled_tests = data.get('enabled_tests', [])
            dcgm_level = data.get('dcgm_level', 1)
            
            # 获取test_results字段，应该已经是字典格式
            test_results = data.get('test_results', {})
            performance_pass = data.get('performance_pass', False)
            
            # 根据测试结果计算整体状态（与合并前逻辑一致）
            # 检查DCGM和IB测试结果 - 注意dcgm和ib字段直接是字符串值
            dcgm_result = test_results.get('dcgm', 'Skipped')
            ib_result = test_results.get('ib', 'Skipped')
            
            # 计算健康状态（DCGM和IB都通过才算健康）
            health_pass = (dcgm_result == 'Pass' or dcgm_result == 'Skipped') and (ib_result == 'Pass' or ib_result == 'Skipped')
            
            # 计算整体检查结果
            if performance_pass and health_pass:
                inspection_result = 'Pass'
            else:
                inspection_result = 'No Pass'
            
            # 其他字段使用默认值
            execution_time = data.get('execution_time', 'N/A')
            execution_log = data.get('execution_log', '')
            benchmark_data = data.get('benchmark', {})
            
            # 先检查记录是否存在
            cursor.execute('SELECT created_at FROM diagnostic_results WHERE job_id = ? AND node_name = ?', (job_id, node_name))
            existing_record = cursor.fetchone()
            
            if existing_record:
                # 记录存在，更新时保持原有created_at
                cursor.execute('''
                    UPDATE diagnostic_results 
                    SET job_type = ?, gpu_type = ?, enabled_tests = ?, dcgm_level = ?,
                        inspection_result = ?, performance_pass = ?, health_pass = ?,
                        execution_time = ?, execution_log = ?, benchmark_data = ?,
                        test_results = ?, expires_at = ?, updated_at = datetime('now', 'localtime')
                    WHERE job_id = ? AND node_name = ?
                ''', (
                    'manual', node_name, gpu_type, json.dumps(enabled_tests),
                    dcgm_level, inspection_result, performance_pass, health_pass,
                    execution_time, execution_log, json.dumps(benchmark_data),
                    json.dumps(test_results), datetime.now() + timedelta(days=7),
                    job_id, node_name
                ))
            else:
                # 记录不存在，插入新记录
                cursor.execute('''
                    INSERT INTO diagnostic_results 
                    (job_id, job_type, node_name, gpu_type, enabled_tests, dcgm_level, 
                     inspection_result, performance_pass, health_pass, execution_time, 
                     execution_log, benchmark_data, test_results, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ''', (
                    job_id, 'manual', node_name, gpu_type, json.dumps(enabled_tests),
                    dcgm_level, inspection_result, performance_pass, health_pass,
                    execution_time, execution_log, json.dumps(benchmark_data),
                    json.dumps(test_results), datetime.now() + timedelta(days=7)
                ))
            
            # 同时更新Job状态为completed
            cursor.execute('''
                UPDATE diagnostic_jobs 
                SET status = 'completed', completed_at = datetime('now', 'localtime')
                WHERE job_id = ?
            ''', (data['job_id'],))
            
            conn.commit()
            conn.close()
            
            logger.info(f"成功保存manual诊断结果: {data['job_id']}")
            
        except Exception as e:
            logger.error(f"保存manual诊断结果失败: {e}")
            raise e
    
    def validate_result_data(self, data: Dict[str, Any]) -> bool:
        """验证结果数据格式"""
        has_hostname = 'hostname' in data
        has_test_results = 'test_results' in data
        has_timestamp = 'created_at' in data
        
        if not (has_hostname and has_test_results and has_timestamp):
            logger.warning(f"数据格式不匹配，期望字段: hostname + test_results + created_at")
            logger.warning(f"实际字段: {list(data.keys())}")
            return False
        
        data['timestamp'] = data.get('created_at')
        
        test_results = data.get('test_results', {})
        performance_pass = data.get('performance_pass', False)
        
        dcgm_result = test_results.get('dcgm', 'Skipped')
        ib_result = test_results.get('ib', 'Skipped')
        
        health_pass = (dcgm_result == 'Pass' or dcgm_result == 'Skipped') and (ib_result == 'Pass' or ib_result == 'Skipped')
        
        if performance_pass and health_pass:
            data['inspectionResult'] = 'Pass'
        else:
            data['inspectionResult'] = 'No Pass'
        
        data['executionLog'] = data.get('execution_log', '暂无执行日志数据')
        data['executionTime'] = data.get('execution_time', data.get('timestamp', datetime.now().isoformat()))
        
        logger.info(f"数据验证通过，字段: {list(data.keys())}")
        return True
    
    def save_inspection_result(self, data: Dict[str, Any], file_path: str):
        """保存检查结果到数据库"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            node_name = data.get('node_name', 'unknown')
            pod_name = data.get('pod_name', 'unknown')
            gpu_type = data.get('gpu_type', 'unknown')
            
            test_results = data.get('test_results', {})
            bandwidth_test = test_results.get('bandwidth', {}).get('value', 'N/A')
            p2p_test = test_results.get('p2p', {}).get('value', 'N/A')
            nccl_test = test_results.get('nccl', {}).get('value', 'N/A')
            dcgm_diag = test_results.get('dcgm', 'N/A')
            ib_check = test_results.get('ib', 'N/A')
            
            inspection_result = data.get('inspectionResult', 'Unknown')
            timestamp = data.get('timestamp', datetime.now().isoformat())
            execution_time = data.get('execution_time', 'N/A')
            execution_log = data.get('execution_log', '暂无执行日志数据')
            benchmark = data.get('benchmark', {})
            performance_pass = data.get('performance_pass', False)
            raw_results = test_results
            
            cursor.execute('''
                INSERT INTO gpu_inspections (
                    hostname, node_name, pod_name, gpu_type,
                    bandwidth_test, p2p_bandwidth_latency_test, nccl_tests,
                    dcgm_diag, ib_check, inspection_result, timestamp,
                    execution_time, execution_log, benchmark, performance_pass,
                    raw_results, file_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('hostname'),
                node_name,
                pod_name,
                gpu_type,
                bandwidth_test,
                p2p_test,
                nccl_test,
                dcgm_diag,
                ib_check,
                inspection_result,
                timestamp,
                execution_time,
                execution_log,
                json.dumps(benchmark),
                performance_pass,
                json.dumps(raw_results),
                file_path,
                datetime.now().isoformat()
            ))
            
            conn.commit()
            conn.close()
            logger.info(f"结果已保存到数据库: {data.get('hostname')} - {node_name}")
            
        except Exception as e:
            logger.error(f"保存结果到数据库失败: {e}")
            logger.error(f"数据内容: {data}")
            raise
    
    def get_latest_results(self, hours: int = 24) -> List[Dict[str, Any]]:
        """获取最新的检查结果 - 每个节点只返回最新记录"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            cutoff_time = datetime.now() - timedelta(hours=hours)
            
            cursor.execute('''
                SELECT * FROM gpu_inspections 
                WHERE created_at > ? 
                AND id IN (
                    SELECT MAX(id) 
                    FROM gpu_inspections 
                    WHERE created_at > ? 
                    GROUP BY node_name
                )
                ORDER BY created_at DESC
            ''', (cutoff_time.isoformat(), cutoff_time.isoformat()))
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                try:
                    result = {
                        'id': row[0],
                        'hostname': row[1],
                        'nodeName': row[2],
                        'podName': row[3],
                        'gpuType': row[4],
                        'nvbandwidthTest': row[5],
                        'p2pBandwidthLatencyTest': row[6],
                        'ncclTests': row[7],
                        'dcgmDiag': row[8],
                        'ibCheck': row[9],
                        'inspectionResult': row[10],
                        'timestamp': row[11],
                        'executionTime': row[12],
                        'executionLog': row[13] if row[13] else '暂无执行日志数据',
                        'benchmark': safe_json_loads(row[14], {}),
                        'performancePass': bool(row[15]),
                        'rawResults': safe_json_loads(row[16], {}),
                        'file_path': row[17],
                        'createdAt': row[18]
                    }
                    results.append(result)
                except Exception as e:
                    logger.error(f"处理结果行失败: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"获取最新结果失败: {e}")
            return []
    
    def get_all_historical_results(self) -> List[Dict[str, Any]]:
        """获取所有历史检查结果 - 每个节点只返回最新记录，支持历史追溯"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT * FROM gpu_inspections 
                WHERE id IN (
                    SELECT MAX(id) 
                    FROM gpu_inspections 
                    GROUP BY node_name
                )
                ORDER BY execution_time DESC, created_at DESC
            ''')
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                try:
                    result = {
                        'id': row[0],
                        'hostname': row[1],
                        'nodeName': row[2],
                        'podName': row[3],
                        'gpuType': row[4],
                        'nvbandwidthTest': row[5],
                        'p2pBandwidthLatencyTest': row[6],
                        'ncclTests': row[7],
                        'dcgmDiag': row[8],
                        'ibCheck': row[9],
                        'inspectionResult': row[10],
                        'timestamp': row[11],
                        'executionTime': row[12],
                        'executionLog': row[13] if row[13] else '暂无执行日志数据',
                        'benchmark': safe_json_loads(row[14], {}),
                        'performancePass': bool(row[15]),
                        'rawResults': safe_json_loads(row[16], {}),
                        'file_path': row[17],
                        'createdAt': row[18]
                    }
                    results.append(result)
                except Exception as e:
                    logger.error(f"处理历史结果行失败: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"获取历史结果失败: {e}")
            return []
    
    def get_summary(self, hours: int = 24) -> Dict[str, Any]:
        """获取检查摘要"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            cutoff_time = datetime.now() - timedelta(hours=hours)
            
            cursor.execute('''
                SELECT COUNT(*) FROM gpu_inspections 
                WHERE created_at > ?
            ''', (cutoff_time.isoformat(),))
            total_nodes = cursor.fetchone()[0]
            
            cursor.execute('''
                SELECT COUNT(*) FROM gpu_inspections 
                WHERE created_at > ? AND inspection_result = 'Pass'
            ''', (cutoff_time.isoformat(),))
            passed_nodes = cursor.fetchone()[0]
            
            failed_nodes = total_nodes - passed_nodes
            
            cursor.execute('''
                SELECT MAX(created_at) FROM gpu_inspections 
                WHERE created_at > ?
            ''', (cutoff_time.isoformat(),))
            last_updated = cursor.fetchone()[0]
            
            conn.close()
            
            return {
                'totalNodes': total_nodes,
                'passedNodes': passed_nodes,
                'failedNodes': failed_nodes,
                'lastUpdated': last_updated
            }
            
        except Exception as e:
            logger.error(f"获取摘要失败: {e}")
            return {
                'totalNodes': 0,
                'passedNodes': 0,
                'failedNodes': 0,
                'lastUpdated': None
            }

# ============================================================================
# Kubernetes客户端初始化 (来自gpu_cli)
# ============================================================================
def init_kubernetes_client():
    """初始化Kubernetes客户端"""
    if not KUBERNETES_AVAILABLE:
        logger.warning("Kubernetes包不可用，将使用kubectl命令")
        return None
    
    try:
        config_loaded = False
        
        try:
            config.load_kube_config()
            logger.info("从默认kubeconfig文件加载Kubernetes配置")
            config_loaded = True
        except Exception as e:
            logger.debug(f"默认kubeconfig加载失败: {e}")
        
        if not config_loaded:
            kubeconfig_paths = [
                "/root/.kube/config",
                os.path.expanduser("~/.kube/config"),
                "/etc/kubernetes/admin.conf"
            ]
            
            for kubeconfig_path in kubeconfig_paths:
                if os.path.exists(kubeconfig_path):
                    try:
                        config.load_kube_config(config_file=kubeconfig_path)
                        logger.info(f"从 {kubeconfig_path} 加载Kubernetes配置")
                        config_loaded = True
                        break
                    except Exception as e:
                        logger.debug(f"从 {kubeconfig_path} 加载配置失败: {e}")
        
        if not config_loaded:
            try:
                config.load_incluster_config()
                logger.info("使用in-cluster Kubernetes配置")
                config_loaded = True
            except Exception as e:
                logger.debug(f"in-cluster配置加载失败: {e}")
        
        if not config_loaded:
            logger.error("无法加载任何Kubernetes配置")
            return None
        
        v1 = client.CoreV1Api()
        batch_v1 = client.BatchV1Api()
        
        try:
            namespaces = v1.list_namespace(limit=1)
            logger.info("Kubernetes客户端初始化成功，连接测试通过")
            return v1, batch_v1
        except Exception as e:
            logger.error(f"Kubernetes连接测试失败: {e}")
            return None
            
    except Exception as e:
        logger.error(f"Kubernetes客户端初始化失败: {e}")
        return None

# 初始化Kubernetes客户端
kubernetes_client = init_kubernetes_client()

# ============================================================================
# 全局变量和初始化
# ============================================================================
collector = GPUDataCollector()

# 添加缓存机制（来自合并前的gpu_cli.py）
job_list_cache = {}
job_list_cache_timeout = 5  # 5秒缓存
diagnostic_results_cache = {}
diagnostic_results_cache_timeout = 5  # 5秒缓存

def get_diagnostic_results_rate_limit_decorator():
    """诊断结果查询的宽松限流装饰器 - 1分钟内允许30次请求（来自合并前的gpu_cli.py）"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = request.remote_addr
            current_time = time.time()
            
            # 为诊断结果查询提供更宽松的限制 - 1分钟内允许30次请求
            cache_key = f"{client_ip}_diagnostic_results_rate_limit"
            
            # 获取当前时间窗口内的请求记录
            if cache_key in job_list_cache:
                request_times, _ = job_list_cache[cache_key]
                if isinstance(request_times, (list, tuple)):
                    # 清理超过1分钟的记录
                    request_times = [t for t in request_times if current_time - t < 60]
                    
                    # 检查是否超过限制（30次/分钟）
                    if len(request_times) >= 30:
                        logger.warning(f"诊断结果查询频率限制: {client_ip} (1分钟内已请求{len(request_times)}次)")
                        return jsonify({"error": "诊断结果查询过于频繁，请稍后再试"}), 429
                    
                    # 添加当前请求时间
                    request_times.append(current_time)
                else:
                    # 兼容旧格式，转换为新格式
                    request_times = [current_time]
            else:
                request_times = [current_time]
            
            # 更新缓存
            job_list_cache[cache_key] = (request_times, {})
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def clear_client_cache(client_ip: str):
    """清理指定客户端的缓存（来自合并前的gpu_cli.py）"""
    try:
        # 清理Job列表缓存
        job_cache_key = f"{client_ip}_job_list"
        if job_cache_key in job_list_cache:
            del job_list_cache[job_cache_key]
            logger.info(f"已清理客户端 {client_ip} 的Job列表缓存")
        
        # 清理诊断结果缓存
        diagnostic_cache_key = f"{client_ip}_diagnostic_results"
        if diagnostic_cache_key in diagnostic_results_cache:
            del diagnostic_results_cache[diagnostic_cache_key]
            logger.info(f"已清理客户端 {client_ip} 的诊断结果缓存")
            
    except Exception as e:
        logger.warning(f"清理客户端缓存失败: {e}")

def clear_all_cache():
    """清理所有缓存（来自合并前的gpu_cli.py）"""
    try:
        job_list_cache.clear()
        diagnostic_results_cache.clear()
        logger.info("已清理所有缓存")
    except Exception as e:
        logger.warning(f"清理所有缓存失败: {e}")

# 初始化限流
rate_limit_type = init_rate_limit(app, use_redis=False, use_flask_limiter=False)
setup_rate_limit_error_handlers(app)

# ============================================================================
# API路由 - 数据收集相关 (来自gpu_collector_service)
# ============================================================================
@app.route('/api/gpu-inspection', methods=['GET'])
def get_gpu_inspection():
    """获取GPU检查结果"""
    try:
        include_history = request.args.get('include_history', 'false').lower() == 'true'
        hours = int(request.args.get('hours', 24))
        
        if include_history:
            results = collector.get_all_historical_results()
            logger.info(f"返回所有历史数据，共 {len(results)} 条记录")
        else:
            results = collector.get_latest_results(hours)
            logger.info(f"返回最近 {hours} 小时数据，共 {len(results)} 条记录")
        
        summary = collector.get_summary(hours)
        
        response = {
            'summary': summary,
            'nodes': results,
            'includeHistory': include_history
        }
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"获取GPU检查结果失败: {e}")
        return jsonify({
            'error': 'Failed to get GPU inspection results',
            'message': str(e)
        }), 500

@app.route('/api/gpu-inspection/history', methods=['GET'])
def get_gpu_inspection_history():
    """获取所有历史GPU检查结果"""
    try:
        results = collector.get_all_historical_results()
        summary = collector.get_summary(24)
        
        response = {
            'summary': summary,
            'nodes': results,
            'includeHistory': True,
            'totalHistoricalNodes': len(results)
        }
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"获取历史GPU检查结果失败: {e}")
        return jsonify({
            'error': 'Failed to get historical GPU inspection results',
            'message': str(e)
        }), 500

@app.route('/api/gpu-inspection/summary', methods=['GET'])
def get_gpu_inspection_summary():
    """获取GPU检查摘要"""
    try:
        hours = int(request.args.get('hours', 24))
        summary = collector.get_summary(hours)
        return jsonify(summary)
        
    except Exception as e:
        logger.error(f"获取GPU检查摘要失败: {e}")
        return jsonify({
            'error': 'Failed to get GPU inspection summary',
            'message': str(e)
        }), 500

@app.route('/api/gpu-inspection/collect', methods=['POST'])
def trigger_collection():
    """手动触发数据收集"""
    try:
        logger.info("手动触发数据收集...")
        collector.collect_from_shared_pvc()
        
        return jsonify({
            'status': 'success',
            'message': 'Data collection completed'
        })
        
    except Exception as e:
        logger.error(f"数据收集失败: {e}")
        return jsonify({
            'error': 'Failed to collect data',
            'message': str(e)
        }), 500

# ============================================================================
# API路由 - 节点状态和Job管理 (来自gpu_cli)
# ============================================================================
@app.route('/api/gpu-inspection/node-status', methods=['GET'])
def get_gpu_node_status():
    """获取GPU节点状态"""
    try:
        if kubernetes_client:
            v1, batch_v1 = kubernetes_client
            nodes = v1.list_node()
            
            gpu_nodes = []
            for node in nodes.items:
                if has_gpu_resources(node):
                    node_info = parse_node_info(node)
                    gpu_nodes.append(node_info)
            
            return jsonify({
                'nodes': gpu_nodes,
                'total': len(gpu_nodes)
            })
        else:
            return get_gpu_node_status_kubectl()
            
    except Exception as e:
        logger.error(f"获取GPU节点状态失败: {e}")
        return jsonify({
            'error': 'Failed to get GPU node status',
            'message': str(e)
        }), 500

def has_gpu_resources(node):
    """检查节点是否有GPU资源"""
    try:
        if node.status and node.status.allocatable:
            for key in node.status.allocatable:
                if 'nvidia.com/gpu' in key or 'gpu' in key.lower():
                    return True
        return False
    except Exception:
        return False

def get_gpu_requested_count(node_name):
    """获取节点已请求的GPU数量"""
    try:
        if kubernetes_client:
            v1, batch_v1 = kubernetes_client
            # 获取节点上的所有Pod
            pods = v1.list_pod_for_all_namespaces(field_selector=f"spec.nodeName={node_name}")
            
            total_requested = 0
            for pod in pods.items:
                if pod.status.phase in ['Running', 'Pending']:
                    for container in pod.spec.containers:
                        if container.resources and container.resources.requests:
                            for key, value in container.resources.requests.items():
                                if 'nvidia.com/gpu' in key:
                                    try:
                                        total_requested += int(value)
                                    except ValueError:
                                        pass
            return total_requested
        else:
            # 使用kubectl获取
            return get_gpu_requested_count_kubectl(node_name)
    except Exception as e:
        logger.error(f"获取节点 {node_name} 已请求GPU数量失败: {e}")
        return 0

def get_gpu_requested_count_kubectl(node_name):
    """使用kubectl获取节点已请求的GPU数量"""
    try:
        result = subprocess.run([
            'kubectl', 'get', 'pods', '--all-namespaces', 
            '--field-selector', f'spec.nodeName={node_name}',
            '-o', 'json'
        ], capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.warning(f"kubectl获取Pod信息失败: {result.stderr}")
            return 0
        
        pods_data = json.loads(result.stdout)
        total_requested = 0
        
        for pod in pods_data.get('items', []):
            pod_status = pod.get('status', {}).get('phase', '')
            if pod_status in ['Running', 'Pending']:
                containers = pod.get('spec', {}).get('containers', [])
                for container in containers:
                    requests = container.get('resources', {}).get('requests', {})
                    for key, value in requests.items():
                        if 'nvidia.com/gpu' in key:
                            try:
                                total_requested += int(value)
                            except ValueError:
                                pass
        
        return total_requested
    except Exception as e:
        logger.error(f"kubectl获取节点 {node_name} 已请求GPU数量失败: {e}")
        return 0

def get_gpu_info_from_kubectl_resource_view(node_name=None):
    """使用kubectl-resource-view工具统一获取GPU信息"""
    try:
        # 如果指定了节点名，只查询该节点
        if node_name:
            cmd = ['/usr/local/bin/kubectl-resource-view', 'node', node_name, '-t', 'gpu', '--no-format']
        else:
            cmd = ['/usr/local/bin/kubectl-resource-view', 'node', '-t', 'gpu', '--no-format']
        
        # 使用kubectl-resource-view获取GPU信息 - 增加超时时间到2分钟
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode == 0:
            gpu_info_map = {}
            lines = result.stdout.strip().split('\n')
            
            # 跳过表头行
            data_lines = lines[1:] if len(lines) > 1 else []
            
            for line in data_lines:
                if line.strip():
                    # 解析格式: hd03-gpu2-0011          0               0%                      0               0%                      nvidia.com/gpu-h200
                    # 使用正则表达式或固定位置解析
                    import re
                    
                    # 使用正则表达式匹配节点名和GPU信息
                    # 节点名通常在行首，GPU类型在GPU MODEL列
                    match = re.match(r'^(\S+)\s+(\d+)\s+\d+%\s+(\d+)\s+\d+%\s+(nvidia\.com/gpu-\S+|amd\.com/gpu-\S+|N/A)', line)
                    
                    if match:
                        current_node_name = match.group(1)
                        gpu_requested = int(match.group(2))
                        gpu_limit = int(match.group(3))
                        gpu_type = match.group(4)
                        
                        # 过滤掉表头行和没有GPU的节点
                        if current_node_name.upper() in ['NODE', 'NVIDIA/GPU REQ', 'NVIDIA/GPU REQ(%)', 'NVIDIA/GPU LIM', 'NVIDIA/GPU LIM(%)', 'GPU MODEL']:
                            continue
                        
                        # 跳过没有GPU的节点
                        if gpu_type == 'N/A':
                            continue
                        
                        gpu_info_map[current_node_name] = {
                            'gpu_type': gpu_type,
                            'gpu_requested': gpu_requested,
                            'gpu_limit': gpu_limit,
                            'gpu_count': gpu_limit  # GPU总数等于限制数
                        }
            
            # 如果指定了节点名，只返回该节点的信息
            if node_name and node_name in gpu_info_map:
                return gpu_info_map[node_name]
            elif node_name:
                # 如果指定了节点名但没找到，返回默认值
                return {
                    'gpu_type': 'Unknown',
                    'gpu_requested': 0,
                    'gpu_limit': 0,
                    'gpu_count': 0
                }
            else:
                # 如果没有指定节点名，返回所有节点的信息
                return gpu_info_map
        
        # 如果kubectl-resource-view失败，返回默认值
        return {
            'gpu_type': 'Unknown',
            'gpu_requested': 0,
            'gpu_limit': 0,
            'gpu_count': 0
        }
        
    except Exception as e:
        logger.warning(f"使用kubectl-resource-view获取GPU信息失败: {e}")
        return {
            'gpu_type': 'Unknown',
            'gpu_requested': 0,
            'gpu_limit': 0,
            'gpu_count': 0
        }

def parse_node_info(node):
    """解析节点信息 - 统一使用kubectl-resource-view工具获取GPU信息"""
    try:
        # 获取节点基本信息
        node_name = node.metadata.name
        is_ready = any(condition.type == 'Ready' and condition.status == 'True' 
                      for condition in node.status.conditions) if node.status and node.status.conditions else False
        
        # 使用kubectl-resource-view工具统一获取GPU信息
        gpu_info = get_gpu_info_from_kubectl_resource_view(node_name)
        
        # 确定节点状态
        node_status = 'idle' if gpu_info['gpu_requested'] == 0 else 'busy'
        
        # 确保GPU类型格式正确（完整的资源名称）
        gpu_type = gpu_info['gpu_type']
        if gpu_type and not gpu_type.startswith('nvidia.com/') and not gpu_type.startswith('amd.com/') and gpu_type != 'Unknown':
            # 如果GPU类型不是完整格式，补充前缀
            if gpu_type.startswith('gpu-'):
                gpu_type = f'nvidia.com/{gpu_type}'
            else:
                gpu_type = f'nvidia.com/gpu-{gpu_type}'
        
        node_info = {
            'nodeName': node_name,
            'gpuType': gpu_type,
            'gpuRequested': gpu_info['gpu_requested'],
            'nodeStatus': node_status,
            'gpuCount': gpu_info['gpu_count'],
            'status': 'Ready' if is_ready else 'NotReady',
            'timestamp': datetime.now().isoformat()
        }
        
        return node_info
    except Exception as e:
        logger.error(f"解析节点信息失败: {e}")
        return {
            'nodeName': node.metadata.name if node.metadata else 'Unknown',
            'gpuType': 'Unknown',
            'gpuRequested': 0,
            'nodeStatus': 'unknown',
            'gpuCount': 0,
            'status': 'Unknown',
            'timestamp': datetime.now().isoformat()
        }

def get_gpu_node_status_kubectl():
    """使用kubectl获取GPU节点状态"""
    try:
        result = subprocess.run([
            'kubectl', 'get', 'nodes', '-o', 'json'
        ], capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            raise Exception(f"kubectl命令执行失败: {result.stderr}")
        
        nodes_data = json.loads(result.stdout)
        gpu_nodes = []
        
        for node in nodes_data.get('items', []):
            if has_gpu_resources_kubectl(node):
                node_info = parse_node_info_kubectl(node)
                gpu_nodes.append(node_info)
        
        return jsonify({
            'nodes': gpu_nodes,
            'total': len(gpu_nodes)
        })
        
    except Exception as e:
        logger.error(f"使用kubectl获取GPU节点状态失败: {e}")
        return jsonify({
            'error': 'Failed to get GPU node status via kubectl',
            'message': str(e)
        }), 500

def has_gpu_resources_kubectl(node):
    """检查节点是否有GPU资源 (kubectl版本)"""
    try:
        allocatable = node.get('status', {}).get('allocatable', {})
        for key in allocatable:
            if 'nvidia.com/gpu' in key or 'gpu' in key.lower():
                return True
        return False
    except Exception:
        return False

def parse_node_info_kubectl(node):
    """解析节点信息 (kubectl版本) - 统一使用kubectl-resource-view工具获取GPU信息"""
    try:
        # 获取节点基本信息
        node_name = node.get('metadata', {}).get('name', 'Unknown')
        
        # 检查节点状态
        conditions = node.get('status', {}).get('conditions', [])
        is_ready = False
        for condition in conditions:
            if condition.get('type') == 'Ready' and condition.get('status') == 'True':
                is_ready = True
                break
        
        # 使用kubectl-resource-view工具统一获取GPU信息
        gpu_info = get_gpu_info_from_kubectl_resource_view(node_name)
        
        # 确定节点状态
        node_status = 'idle' if gpu_info['gpu_requested'] == 0 else 'busy'
        
        # 确保GPU类型格式正确（完整的资源名称）
        gpu_type = gpu_info['gpu_type']
        if gpu_type and not gpu_type.startswith('nvidia.com/') and not gpu_type.startswith('amd.com/') and gpu_type != 'Unknown':
            # 如果GPU类型不是完整格式，补充前缀
            if gpu_type.startswith('gpu-'):
                gpu_type = f'nvidia.com/{gpu_type}'
            else:
                gpu_type = f'nvidia.com/gpu-{gpu_type}'
        
        node_info = {
            'nodeName': node_name,
            'gpuType': gpu_type,
            'gpuRequested': gpu_info['gpu_requested'],
            'nodeStatus': node_status,
            'gpuCount': gpu_info['gpu_count'],
            'status': 'Ready' if is_ready else 'NotReady',
            'timestamp': datetime.now().isoformat()
        }
        
        return node_info
    except Exception as e:
        logger.error(f"解析节点信息失败 (kubectl): {e}")
        return {
            'nodeName': 'Unknown',
            'gpuType': 'Unknown',
            'gpuRequested': 0,
            'nodeStatus': 'unknown',
            'gpuCount': 0,
            'status': 'Unknown',
            'timestamp': datetime.now().isoformat()
        }

def delete_job_internal(job_id):
    """内部删除Job函数，不返回HTTP响应"""
    try:
        logger.info(f"开始删除Job: {job_id}")
        
        # 首先从数据库中删除Job记录
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # 1. 查询诊断结果信息，用于删除PVC文件
            cursor.execute('''
                SELECT node_name FROM diagnostic_results 
                WHERE job_id = ?
            ''', (job_id,))
            
            result_info = cursor.fetchone()
            node_name = result_info[0] if result_info else None
            
            logger.info(f"查询Job {job_id} 的节点信息: {node_name}")
            
            # 2. 如果从诊断结果中无法获取节点信息，尝试从Job记录中获取
            if not node_name:
                cursor.execute('''
                    SELECT selected_nodes FROM diagnostic_jobs 
                    WHERE job_id = ?
                ''', (job_id,))
                
                job_info = cursor.fetchone()
                if job_info and job_info[0]:
                    try:
                        selected_nodes = json.loads(job_info[0])
                        if selected_nodes and len(selected_nodes) > 0:
                            node_name = selected_nodes[0]  # 取第一个节点
                            logger.info(f"从Job记录中获取到节点信息: {node_name}")
                    except Exception as json_error:
                        logger.warning(f"解析Job节点信息失败: {json_error}")
                
                if not node_name:
                    logger.warning(f"无法获取Job {job_id} 的节点信息，将尝试通过文件名匹配删除PVC文件")
            
            # 3. 删除相关的诊断结果
            cursor.execute("DELETE FROM diagnostic_results WHERE job_id = ?", (job_id,))
            results_deleted = cursor.rowcount > 0
            
            # 4. 删除Job记录
            cursor.execute("DELETE FROM diagnostic_jobs WHERE job_id = ?", (job_id,))
            job_deleted = cursor.rowcount > 0
            
            conn.commit()
            conn.close()
            
            logger.info(f"数据库清理完成: Job记录={job_deleted}, 诊断结果={results_deleted}")
            
            # 5. 删除相关的PVC文件
            try:
                if node_name:
                    logger.info(f"开始删除Job {job_id} 相关的PVC文件，节点: {node_name}")
                    delete_pvc_files_for_job(job_id, node_name)
                    logger.info(f"成功删除Job {job_id} 相关的PVC文件")
                else:
                    # 即使没有节点信息，也尝试通过job_id删除相关文件
                    logger.info(f"尝试通过job_id删除Job {job_id} 相关的PVC文件")
                    delete_pvc_files_for_job(job_id, "unknown")
                    logger.info(f"通过job_id删除Job {job_id} 相关的PVC文件完成")
            except Exception as pvc_error:
                logger.warning(f"删除Job {job_id} 相关的PVC文件失败: {pvc_error}")
            
        except Exception as e:
            logger.error(f"数据库清理失败: {e}")
            # 即使数据库清理失败，也继续尝试删除Kubernetes Job
        
        # 删除Kubernetes Job
        try:
            # 查找所有相关的Job名称
            result = subprocess.run([
                'kubectl', 'get', 'jobs', '-n', 'gpu-health-expert', 
                '--field-selector', f'metadata.labels.job-id={job_id}',
                '-o', 'jsonpath={.items[*].metadata.name}'
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0 and result.stdout.strip():
                job_names = result.stdout.strip().split()
                logger.info(f"找到相关Kubernetes Jobs: {job_names}")
                
                for job_name in job_names:
                    # 删除Job
                    delete_result = subprocess.run([
                        'kubectl', 'delete', 'job', job_name, '-n', 'gpu-health-expert'
                    ], capture_output=True, text=True, timeout=180)
                    
                    if delete_result.returncode == 0:
                        logger.info(f"成功删除Kubernetes Job: {job_name}")
                    else:
                        logger.warning(f"删除Kubernetes Job失败: {job_name}, 错误: {delete_result.stderr}")
                        
                    # 删除相关的Pod
                    pod_result = subprocess.run([
                        'kubectl', 'delete', 'pods', '-n', 'gpu-health-expert',
                        '--field-selector', f'job-name={job_name}'
                    ], capture_output=True, text=True, timeout=60)
                    
                    if pod_result.returncode == 0:
                        logger.info(f"成功删除相关Pod: {job_name}")
                    else:
                        logger.warning(f"删除相关Pod失败: {job_name}, 错误: {pod_result.stderr}")
            else:
                logger.info(f"未找到相关的Kubernetes Job: {job_id}")
                
        except Exception as e:
            logger.warning(f"删除Kubernetes Job失败: {e}")
        
        return {"success": True, "message": f"Job {job_id} 删除成功"}
        
    except Exception as e:
        logger.error(f"删除Job失败: {e}")
        return {"success": False, "error": str(e)}

def delete_job_with_kubernetes_client(job_id):
    """使用Kubernetes客户端删除Job"""
    try:
        if not KUBERNETES_AVAILABLE or not kubernetes_client:
            logger.warning("Kubernetes客户端不可用，回退到kubectl命令")
            return delete_job_with_kubectl(job_id)
        
        v1, batch_v1 = kubernetes_client
        
        # 查找所有相关的Job
        jobs = batch_v1.list_namespaced_job(
            namespace='gpu-health-expert',
            label_selector=f'job-id={job_id}'
        )
        
        deleted_jobs = []
        for job in jobs.items:
            try:
                # 删除Job
                batch_v1.delete_namespaced_job(
                    name=job.metadata.name,
                    namespace='gpu-health-expert',
                    grace_period_seconds=0,
                    propagation_policy='Background'
                )
                deleted_jobs.append(job.metadata.name)
                logger.info(f"成功删除Job: {job.metadata.name}")
                
                # 删除相关的Pod
                pods = v1.list_namespaced_pod(
                    namespace='gpu-health-expert',
                    label_selector=f'job-name={job.metadata.name}'
                )
                
                for pod in pods.items:
                    try:
                        v1.delete_namespaced_pod(
                            name=pod.metadata.name,
                            namespace='gpu-health-expert',
                            grace_period_seconds=0
                        )
                        logger.info(f"成功删除Pod: {pod.metadata.name}")
                    except Exception as pod_error:
                        logger.warning(f"删除Pod {pod.metadata.name} 失败: {pod_error}")
                        
            except Exception as job_error:
                logger.warning(f"删除Job {job.metadata.name} 失败: {job_error}")
        
        if deleted_jobs:
            logger.info(f"成功删除 {len(deleted_jobs)} 个Job: {deleted_jobs}")
            return True, f"成功删除 {len(deleted_jobs)} 个Job"
        else:
            logger.warning(f"未找到Job ID为 {job_id} 的Job")
            return False, f"未找到Job ID为 {job_id} 的Job"
            
    except Exception as e:
        logger.error(f"使用Kubernetes客户端删除Job失败: {e}")
        return False, str(e)

def delete_job_with_kubectl(job_id):
    """使用kubectl命令删除Job（回退方案）"""
    try:
        # 查找所有相关的Job
        result = subprocess.run([
            'kubectl', 'get', 'jobs', '-n', 'gpu-health-expert', 
            '-l', f'job-id={job_id}', '--no-headers', '-o', 'custom-columns=:metadata.name'
        ], capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            logger.error(f"查找Job失败: {result.stderr}")
            return False, result.stderr
        
        job_names = [name.strip() for name in result.stdout.split('\n') if name.strip()]
        
        if not job_names:
            logger.warning(f"未找到Job ID为 {job_id} 的Job")
            return False, f"未找到Job ID为 {job_id} 的Job"
        
        deleted_jobs = []
        for job_name in job_names:
            try:
                # 删除Job
                delete_result = subprocess.run([
                    'kubectl', 'delete', 'job', job_name, '-n', 'gpu-health-expert'
                ], capture_output=True, text=True, timeout=60)
                
                if delete_result.returncode == 0:
                    deleted_jobs.append(job_name)
                    logger.info(f"成功删除Job: {job_name}")
                    
                    # 删除相关的Pod
                    pod_result = subprocess.run([
                        'kubectl', 'delete', 'pods', '-n', 'gpu-health-expert',
                        '--field-selector', f'job-name={job_name}'
                    ], capture_output=True, text=True, timeout=60)
                    
                    if pod_result.returncode == 0:
                        logger.info(f"成功删除相关Pod: {job_name}")
                    else:
                        logger.warning(f"删除相关Pod失败: {job_name}, 错误: {pod_result.stderr}")
                else:
                    logger.warning(f"删除Job失败: {job_name}, 错误: {delete_result.stderr}")
                    
            except Exception as e:
                logger.warning(f"删除Job {job_name} 失败: {e}")
        
        if deleted_jobs:
            logger.info(f"成功删除 {len(deleted_jobs)} 个Job: {deleted_jobs}")
            return True, f"成功删除 {len(deleted_jobs)} 个Job"
        else:
            logger.warning(f"未找到Job ID为 {job_id} 的Job")
            return False, f"未找到Job ID为 {job_id} 的Job"
            
    except Exception as e:
        logger.error(f"使用kubectl删除Job失败: {e}")
        return False, str(e)

def delete_pvc_files_for_job(job_id: str, node_name: str):
    """删除指定Job的PVC文件"""
    try:
        logger.info(f"开始删除PVC文件: job_id={job_id}, node_name={node_name}")
        
        pvc_path = '/shared/gpu-inspection-results/manual'
        logger.info(f"检查PVC路径: {pvc_path}")
        
        if not os.path.exists(pvc_path):
            logger.warning(f"PVC路径不存在: {pvc_path}")
            return
        
        logger.info(f"PVC路径存在，开始查找文件...")
        
        # 列出目录中的所有文件
        all_files = os.listdir(pvc_path)
        logger.info(f"目录中的所有文件: {all_files}")
        
        deleted_files = []
        
        # 策略1: 查找包含job_id的文件（精确匹配）
        logger.info(f"策略1: 查找包含job_id '{job_id}' 的文件...")
        for filename in all_files:
            if filename.endswith('.json'):
                # 检查文件名是否包含job_id
                if job_id in filename:
                    file_path = os.path.join(pvc_path, filename)
                    logger.info(f"找到匹配文件: {file_path}")
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            # 验证文件是否真的被删除
                            if os.path.exists(file_path):
                                logger.warning(f"文件删除后仍然存在: {file_path}")
                            else:
                                deleted_files.append(filename)
                                logger.info(f"成功删除PVC文件: {filename}")
                        else:
                            logger.warning(f"文件不存在，无法删除: {file_path}")
                    except Exception as e:
                        logger.warning(f"删除PVC文件失败: {filename}, 错误: {e}")
        
        # 策略1.5: 查找包含node_name的所有文件（因为文件名只包含node_name，不包含job_id）
        logger.info(f"策略1.5: 查找包含node_name '{node_name}' 的所有文件...")
        for filename in all_files:
            if filename.endswith('.json') and node_name in filename:
                # 避免重复删除（如果策略1已经删除了）
                if filename not in deleted_files:
                    file_path = os.path.join(pvc_path, filename)
                    logger.info(f"找到node_name匹配文件: {file_path}")
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            # 验证文件是否真的被删除
                            if os.path.exists(file_path):
                                logger.warning(f"文件删除后仍然存在: {file_path}")
                            else:
                                deleted_files.append(filename)
                                logger.info(f"成功删除PVC文件: {filename}")
                        else:
                            logger.warning(f"文件不存在，无法删除: {file_path}")
                    except Exception as e:
                        logger.warning(f"删除PVC文件失败: {filename}, 错误: {e}")
        
        # 策略2: 查找包含node_name的latest文件
        logger.info(f"策略2: 查找包含node_name '{node_name}' 的latest文件...")
        latest_pattern = f"{node_name}_latest.json"
        latest_file_path = os.path.join(pvc_path, latest_pattern)
        logger.info(f"查找latest文件: {latest_file_path}")
        
        if os.path.exists(latest_file_path):
            logger.info(f"找到latest文件: {latest_file_path}")
            try:
                os.remove(latest_file_path)
                # 验证文件是否真的被删除
                if os.path.exists(latest_file_path):
                    logger.warning(f"latest文件删除后仍然存在: {latest_file_path}")
                else:
                    deleted_files.append(latest_pattern)
                    logger.info(f"成功删除PVC latest文件: {latest_pattern}")
            except Exception as e:
                logger.warning(f"删除PVC latest文件失败: {latest_pattern}, 错误: {e}")
        else:
            logger.info(f"latest文件不存在: {latest_file_path}")
        
        logger.info(f"PVC文件删除完成，共删除 {len(deleted_files)} 个文件: {deleted_files}")
        
    except Exception as e:
        logger.error(f"删除PVC文件异常: {e}")

# ============================================================================
# Job管理API
# ============================================================================
@app.route('/api/gpu-inspection/delete-job', methods=['POST'])
@get_rate_limit_decorator()
def delete_job():
    """删除指定的Job"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        job_id = data.get('jobId')
        if not job_id:
            return jsonify({"error": "缺少Job ID参数"}), 400
        
        logger.info(f"开始删除Job: {job_id}")
        
        # 调用内部删除函数
        result = delete_job_internal(job_id)
        
        if result.get('success'):
            logger.info(f"Job删除完成: {job_id}")
            return jsonify({
                "success": True,
                "message": f"Job {job_id} 删除成功",
                "jobId": job_id
            })
        else:
            logger.error(f"Job删除失败: {job_id}, 错误: {result.get('error')}")
            return jsonify({"error": f"删除Job失败: {result.get('error')}"}), 500
        
    except Exception as e:
        logger.error(f"删除Job异常: {e}")
        return jsonify({"error": f"删除Job失败: {str(e)}"}), 500

@app.route('/api/gpu-inspection/delete-jobs', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def delete_gpu_inspection_jobs():
    """删除GPU检查Job - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        job_ids = data.get('jobIds', [])
        if not job_ids:
            return jsonify({"error": "缺少Job ID列表"}), 400
        
        if not isinstance(job_ids, list):
            return jsonify({"error": "Job ID必须是列表格式"}), 400
        
        # 记录开始删除
        logger.info(f"开始批量删除Job: {job_ids}")
        
        success_count = 0
        failed_count = 0
        deleted_results_count = 0
        
        for job_id in job_ids:
            try:
                # 1. 首先查询相关的诊断结果信息，用于删除PVC文件
                conn = get_db_connection()
                cursor = conn.cursor()
                
                # 查询诊断结果信息
                cursor.execute('''
                    SELECT node_name FROM diagnostic_results 
                    WHERE job_id = ?
                ''', (job_id,))
                
                result_info = cursor.fetchone()
                node_name = result_info[0] if result_info else None
                
                logger.info(f"查询Job {job_id} 的节点信息: {node_name}")
                
                # 如果从诊断结果中无法获取节点信息，尝试从Job记录中获取
                if not node_name:
                    cursor.execute('''
                        SELECT selected_nodes FROM diagnostic_jobs 
                        WHERE job_id = ?
                    ''', (job_id,))
                    
                    job_info = cursor.fetchone()
                    if job_info and job_info[0]:
                        try:
                            selected_nodes = json.loads(job_info[0])
                            if selected_nodes and len(selected_nodes) > 0:
                                node_name = selected_nodes[0]  # 取第一个节点
                                logger.info(f"从Job记录中获取到节点信息: {node_name}")
                        except Exception as json_error:
                            logger.warning(f"解析Job节点信息失败: {json_error}")
                
                if not node_name:
                    logger.warning(f"无法获取Job {job_id} 的节点信息，将尝试通过文件名匹配删除PVC文件")
                
                # 删除相关的诊断结果
                cursor.execute('''
                    DELETE FROM diagnostic_results 
                    WHERE job_id = ?
                ''', (job_id,))
                
                deleted_results = cursor.rowcount
                deleted_results_count += deleted_results
                
                if deleted_results > 0:
                    logger.info(f"删除Job {job_id} 相关的诊断结果: {deleted_results} 条")
                    
                    # 删除相关的PVC文件
                    try:
                        if node_name:
                            logger.info(f"开始删除Job {job_id} 相关的PVC文件，节点: {node_name}")
                            delete_pvc_files_for_job(job_id, node_name)
                            logger.info(f"成功删除Job {job_id} 相关的PVC文件")
                        else:
                            # 即使没有节点信息，也尝试通过job_id删除相关文件
                            logger.info(f"尝试通过job_id删除Job {job_id} 相关的PVC文件")
                            delete_pvc_files_for_job(job_id, "unknown")
                            logger.info(f"通过job_id删除Job {job_id} 相关的PVC文件完成")
                    except Exception as pvc_error:
                        logger.warning(f"删除Job {job_id} 相关的PVC文件失败: {pvc_error}")
                
                # 2. 删除Job记录
                cursor.execute('''
                    DELETE FROM diagnostic_jobs 
                    WHERE job_id = ?
                ''', (job_id,))
                
                deleted_jobs = cursor.rowcount
                
                if deleted_jobs > 0:
                    success_count += 1
                    logger.info(f"成功删除Job: {job_id}")
                else:
                    failed_count += 1
                    logger.warning(f"未找到要删除的Job: {job_id}")
                
                conn.commit()
                conn.close()
                
                # 3. 尝试删除Kubernetes Job（如果存在）
                try:
                    result = subprocess.run([
                        'kubectl', 'delete', 'job', f'ghx-manual-job-{job_id}', 
                        '--force', '--grace-period=0'
                    ], capture_output=True, text=True, timeout=60)
                    
                    if result.returncode == 0:
                        logger.info(f"成功删除Kubernetes Job: {job_id}")
                    else:
                        logger.warning(f"删除Kubernetes Job失败: {job_id}, 错误: {result.stderr}")
                        
                except subprocess.TimeoutExpired:
                    logger.warning(f"删除Kubernetes Job超时: {job_id}")
                except Exception as e:
                    logger.warning(f"删除Kubernetes Job异常: {job_id}, 错误: {e}")
                
            except Exception as e:
                failed_count += 1
                logger.error(f"删除Job {job_id} 失败: {e}")
        
        # 记录删除完成
        logger.info(f"批量删除Job完成: 成功={success_count}, 失败={failed_count}, 删除诊断结果={deleted_results_count}条")
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "delete_gpu_inspection_jobs", "allowed")
        
        return jsonify({
            "success": True,
            "message": f"批量删除完成: 成功={success_count}, 失败={failed_count}, 删除诊断结果={deleted_results_count}条",
            "deletedJobs": success_count,
            "failedJobs": failed_count,
            "deletedResults": deleted_results_count
        })
                
    except Exception as e:
        logger.error(f"批量删除Job失败: {e}")
        return jsonify({
            "error": f"批量删除Job失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/create-job', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def create_gpu_inspection_job():
    """创建GPU检查Job - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        # 验证必需参数
        required_fields = ['selectedNodes', 'enabledTests']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"缺少必需参数: {field}"}), 400
        
        selected_nodes = data['selectedNodes']
        enabled_tests = data['enabledTests']
        dcgm_level = data.get('dcgmLevel', 1)  # 如果不存在则使用默认值1
        
        # 验证参数
        if not selected_nodes:
            return jsonify({"error": "必须选择至少一个节点"}), 400
        
        if not enabled_tests:
            return jsonify({"error": "必须选择至少一个检查项目"}), 400
        
        # 只有当选择了dcgm检查项时才验证dcgm级别
        if 'dcgmDiag' in enabled_tests and dcgm_level not in [1, 2, 3, 4]:
            return jsonify({"error": "DCGM级别必须是1-4之间的整数"}), 400
        
        # 生成唯一的Job ID
        job_id = f"manual-{int(time.time())}-{str(uuid.uuid4())[:8]}"
        
        # 构建环境变量
        enabled_tests_str = ",".join(enabled_tests)
        selected_nodes_str = ",".join(selected_nodes)
        
        # 读取Job模板
        template_path = '/app/job-template.yaml'
        if not os.path.exists(template_path):
            template_path = 'job-template.yaml'  # 开发环境
        
        try:
            with open(template_path, 'r', encoding='utf-8') as f:
                template_content = f.read()
        except FileNotFoundError:
            return jsonify({"error": "Job模板文件不存在"}), 500
        
        # 为每个选中的节点创建单独的Job
        created_jobs = []
        
        for node_name in selected_nodes:
            # 创建节点特定的Job YAML
            node_job_yaml = template_content
            
            # 先替换Job名称，确保每个Job有唯一的名称
            node_job_name = f"ghx-manual-job-{job_id}-{node_name}"
            node_job_yaml = node_job_yaml.replace('ghx-manual-job-{JOB_ID}', node_job_name)
            
            # 获取动态资源信息
            gpu_resource_name = get_gpu_resource_name(node_name)
            rdma_resources = get_rdma_resources(node_name)
            
            # 然后替换其他模板变量
            node_job_yaml = node_job_yaml.replace('{ENABLED_TESTS}', enabled_tests_str)
            node_job_yaml = node_job_yaml.replace('{DCGM_LEVEL}', str(dcgm_level))
            node_job_yaml = node_job_yaml.replace('{SELECTED_NODES}', selected_nodes_str)
            node_job_yaml = node_job_yaml.replace('{GPU_RESOURCE_NAME}', gpu_resource_name)
            
            # 处理RDMA资源：如果为空则删除整行，否则替换变量
            if rdma_resources.strip():
                # 将逗号分隔的资源名称转换为多行格式，每个资源都包含数量
                rdma_device_names = [name.strip() for name in rdma_resources.split(',') if name.strip()]
                rdma_resources_formatted = '\n'.join([f"            {name}: 1" for name in rdma_device_names])
                node_job_yaml = node_job_yaml.replace('            {RDMA_RESOURCES}: 1', rdma_resources_formatted)
            else:
                # 删除包含 {RDMA_RESOURCES} 的整行
                lines = node_job_yaml.split('\n')
                filtered_lines = []
                for line in lines:
                    if '{RDMA_RESOURCES}' not in line:
                        filtered_lines.append(line)
                node_job_yaml = '\n'.join(filtered_lines)
            
            # 替换基础Job ID标签，所有Job使用相同的基础job_id
            node_job_yaml = node_job_yaml.replace('{BASE_JOB_ID}', job_id)
            
            # 替换Job ID环境变量，每个Job使用唯一的job_id
            node_job_yaml = node_job_yaml.replace('{JOB_ID}', f"{job_id}-{node_name}")
            
            # 替换节点名称
            node_job_yaml = node_job_yaml.replace('{NODE_NAME}', node_name)
            
            logger.info(f"为节点 {node_name} 创建Job: {node_job_name}")
            
            # 保存到临时文件
            temp_yaml_path = f"/tmp/job-{node_name}-{job_id}.yaml"
            with open(temp_yaml_path, 'w', encoding='utf-8') as f:
                f.write(node_job_yaml)
            
            try:
                # 使用kubectl创建Job
                result = subprocess.run([
                    'kubectl', 'apply', '-f', temp_yaml_path, '-n', 'gpu-health-expert'
                ], capture_output=True, text=True, timeout=60)
                
                if result.returncode == 0:
                    logger.info(f"成功创建Job {node_job_name}")
                    created_jobs.append(node_job_name)
                else:
                    logger.error(f"创建Job {node_job_name} 失败: {result.stderr}")
                    raise Exception(f"创建Job {node_job_name} 失败: {result.stderr}")
                    
            except Exception as e:
                logger.error(f"创建Job {node_job_name} 异常: {e}")
                raise e
            finally:
                # 清理临时文件
                if os.path.exists(temp_yaml_path):
                    os.remove(temp_yaml_path)
        
        if created_jobs:
            logger.info(f"成功创建 {len(created_jobs)} 个Job: {created_jobs}")
            
            # 将Job信息保存到数据库
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                
                cursor.execute('''
                    INSERT INTO diagnostic_jobs 
                    (job_id, job_name, job_type, selected_nodes, enabled_tests, dcgm_level, status, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ''', (
                    job_id,
                    f"ghx-manual-job-{job_id}",
                    'manual',
                    json.dumps(selected_nodes),
                    json.dumps(enabled_tests),
                    dcgm_level,
                    'pending',
                    datetime.now() + timedelta(days=7)
                ))
                
                conn.commit()
                logger.info(f"Job信息已保存到数据库: {job_id}")
                
            except Exception as db_error:
                logger.error(f"保存Job信息到数据库失败: {db_error}")
                # 即使数据库保存失败，Job创建仍然成功
            
            finally:
                if conn:
                    conn.close()
            
            # 通知SSE客户端Job状态变化（与合并前逻辑一致）
            notify_job_status_change(job_id, 'pending')
            
            # 记录成功请求
            log_rate_limit_event(client_ip, "create_gpu_inspection_job", "allowed")
            
            return jsonify({
                "success": True,
                "jobId": job_id,
                "message": f"成功创建 {len(created_jobs)} 个Job",
                "createdJobs": created_jobs,
                "timestamp": time.time()
            })
        else:
            return jsonify({
                "error": "没有成功创建任何Job"
            }), 500
                
    except Exception as e:
        logger.error(f"创建GPU检查Job失败: {e}")
        return jsonify({
            "error": f"创建GPU检查Job失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/list-jobs', methods=['GET'])
@get_rate_limit_decorator()  # 应用频率限制
def list_gpu_inspection_jobs():
    """列出GPU检查Job - 应用频率限制"""
    client_ip = request.remote_addr
    
    try:
        # 从数据库获取Job列表
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM diagnostic_jobs 
            ORDER BY created_at DESC
        ''')
        
        jobs_data = cursor.fetchall()
        jobs = []
        
        for job in jobs_data:
            # 确保时间字段使用localtime
            created_at = job['created_at']
            if created_at and isinstance(created_at, str):
                # 如果是UTC时间字符串，转换为localtime
                try:
                    # 尝试解析时间并转换为localtime
                    if 'T' in created_at:  # ISO格式
                        # 移除Z后缀并解析
                        time_str = created_at.replace('Z', '')
                        if '+' in time_str:
                            # 已经是带时区的时间，直接解析
                            dt = datetime.fromisoformat(time_str)
                        else:
                            # 假设是UTC时间，添加+00:00
                            dt = datetime.fromisoformat(time_str + '+00:00')
                        
                        # 转换为东八区时间
                        utc_time = dt.replace(tzinfo=timezone.utc)
                        local_dt = utc_time.astimezone(timezone(timedelta(hours=8)))
                        created_at = local_dt.strftime('%Y-%m-%d %H:%M:%S')
                    elif created_at.count(':') == 2:  # 标准格式
                        # 假设已经是localtime，直接使用
                        pass
                except Exception as e:
                    logger.warning(f"时间转换失败: {created_at}, 错误: {e}")
                    # 如果转换失败，保持原值
                    pass
            
            # 获取最新的Kubernetes状态
            current_status = job['status']
            logger.info(f"🔍 Job {job['job_id']}: 数据库状态={current_status}")
            k8s_status = get_kubernetes_job_status(job['job_id'])
            
            # 如果获取到Kubernetes状态，使用真实状态
            if k8s_status:
                pod_status = k8s_status['pod_status']
                logger.info(f"Job {job['job_id']}: 数据库状态={current_status}, K8s状态={pod_status}")
                
                # 总是通知SSE客户端最新的状态，确保前端同步
                if pod_status != current_status:
                    logger.info(f"Job状态发生变化: {current_status} -> {pod_status}")
                    notify_job_status_change(job['job_id'], pod_status)
                    current_status = pod_status
                    
                    # 如果Job已完成，自动触发诊断结果入库
                    if pod_status in ['Completed', 'Succeeded', 'Failed']:
                        logger.info(f"检测到Job完成状态: {pod_status}，开始自动入库...")
                        handle_job_completion(job['job_id'])
                else:
                    # 即使状态相同，也发送心跳通知，确保前端连接活跃
                    logger.debug(f"Job状态未变化，发送心跳: {pod_status}")
                    notify_job_status_change(job['job_id'], pod_status)
            else:
                # 如果无法获取Kubernetes状态，说明Job可能已被删除或不存在
                pod_status = 'unknown'
                logger.info(f"Job {job['job_id']}: 无法获取K8s状态，Job可能已被删除，状态设为unknown")
                # 发送心跳通知，确保前端连接活跃
                notify_job_status_change(job['job_id'], 'unknown')
            
            job_info = {
                "name": job['job_name'],
                "jobId": job['job_id'],
                "status": current_status,
                "selectedNodes": json.loads(job['selected_nodes']) if job['selected_nodes'] else [],
                "enabledTests": json.loads(job['enabled_tests']) if job['enabled_tests'] else [],
                "dcgmLevel": job['dcgm_level'],
                "creationTimestamp": created_at,
                "completionTime": job['completed_at'],
                "startTime": job['started_at']
            }
            jobs.append(job_info)
        
        conn.close()
        
        response_data = {
            "success": True,
            "jobs": jobs,
            "total": len(jobs),
            "timestamp": time.time()
        }
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "list_gpu_inspection_jobs", "allowed")
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"列出GPU检查Job失败: {e}")
        return jsonify({
            "error": f"列出GPU检查Job失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results', methods=['GET'])
@get_diagnostic_results_rate_limit_decorator()  # 应用专门的诊断结果频率限制
def get_diagnostic_results():
    """获取诊断结果列表 - 应用频率限制和缓存"""
    client_ip = request.remote_addr
    
    # 检查缓存（来自合并前的gpu_cli.py）
    current_time = time.time()
    cache_key = f"{client_ip}_diagnostic_results"
    
    if cache_key in diagnostic_results_cache:
        cache_data, cache_time = diagnostic_results_cache[cache_key]
        if current_time - cache_time < diagnostic_results_cache_timeout:
            logger.info(f"使用诊断结果缓存数据，缓存时间: {int(current_time - cache_time)}秒")
            return jsonify(cache_data)
    
    try:
        # 清理过期数据（来自合并前的gpu_cli.py）
        cleanup_expired_data()
        
        # 从数据库获取诊断结果
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM diagnostic_results 
            ORDER BY created_at DESC
        ''')
        
        results_data = cursor.fetchall()
        results = []
        
        for result in results_data:
            # 解析测试结果数据（来自合并前的gpu_cli.py）
            test_results = json.loads(result['test_results']) if result['test_results'] else {}
            benchmark_data = json.loads(result['benchmark_data']) if result['benchmark_data'] else {}
            
            
            # 构建完整的测试结果信息（来自合并前的gpu_cli.py）
            result_info = {
                "id": result['id'],
                "jobId": result['job_id'],
                "jobType": result['job_type'],
                "nodeName": result['node_name'],
                "gpuType": result['gpu_type'],
                "enabledTests": json.loads(result['enabled_tests']) if result['enabled_tests'] else [],
                "dcgmLevel": result['dcgm_level'],
                "inspectionResult": result['inspection_result'],
                "performancePass": result['performance_pass'],
                "healthPass": result['health_pass'],
                "executionTime": result['execution_time'],
                "executionLog": result['execution_log'],  # 添加执行日志字段
                "createdAt": result['created_at'],
                "updatedAt": result['updated_at'] if 'updated_at' in result.keys() else result['created_at'],
                # 添加具体的测试结果值（来自合并前的gpu_cli.py）
                "nvbandwidthTest": test_results.get('bandwidth', {}).get('value', 'N/A') if test_results.get('bandwidth') else 'N/A',
                "p2pBandwidthLatencyTest": test_results.get('p2p', {}).get('value', 'N/A') if test_results.get('p2p') else 'N/A',
                "ncclTests": test_results.get('nccl', {}).get('value', 'N/A') if test_results.get('nccl') else 'N/A',
                "dcgmDiag": test_results.get('dcgm', 'N/A') if test_results.get('dcgm') else 'N/A',
                "ibCheck": test_results.get('ib', 'N/A') if test_results.get('ib') else 'N/A',
                # 保留原始测试结果数据
                "testResults": test_results,
                "benchmarkData": benchmark_data
            }
            results.append(result_info)
        
        conn.close()
        
        response_data = {
            "success": True,
            "results": results,
            "total": len(results),
            "timestamp": current_time,
            "cached": False
        }
        
        # 更新缓存（来自合并前的gpu_cli.py）
        diagnostic_results_cache[cache_key] = (response_data, current_time)
        
        logger.info(f"成功获取{len(results)}条诊断结果，已缓存")
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "get_diagnostic_results", "allowed")
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"获取诊断结果失败: {e}")
        return jsonify({
            "error": f"获取诊断结果失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results/job/<job_id>', methods=['GET'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def get_diagnostic_result_by_job_id(job_id):
    """通过job_id获取诊断结果详情 - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM diagnostic_results 
            WHERE job_id = ?
        ''', (job_id,))
        
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({"error": "诊断结果不存在"}), 404
        
        result_detail = {
            "id": result['id'],
            "jobId": result['job_id'],
            "jobType": result['job_type'],
            "nodeName": result['node_name'],
            "gpuType": result['gpu_type'],
            "enabledTests": json.loads(result['enabled_tests']) if result['enabled_tests'] else [],
            "dcgmLevel": result['dcgm_level'],
            "inspectionResult": result['inspection_result'],
            "performancePass": result['performance_pass'],
            "healthPass": result['health_pass'],
            "executionTime": result['execution_time'],
            "executionLog": result['execution_log'],
            "benchmarkData": json.loads(result['benchmark_data']) if result['benchmark_data'] else {},
            "testResults": json.loads(result['test_results']) if result['test_results'] else {},
            "createdAt": result['created_at'],
            "updatedAt": result['updated_at'] if 'updated_at' in result.keys() else result['created_at']
        }
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "get_diagnostic_result_by_job_id", "allowed")
        
        return jsonify({
            "success": True,
            "result": result_detail,
            "timestamp": time.time()
        })
        
    except Exception as e:
        logger.error(f"获取诊断结果详情失败: {e}")
        return jsonify({
            "error": f"获取诊断结果详情失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/stop-job', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def stop_gpu_inspection_job():
    """停止GPU检查Job - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        job_id = data.get('jobId')
        if not job_id:
            return jsonify({"error": "缺少Job ID"}), 400
        
        logger.info(f"开始停止Job: {job_id}")
        
        # 使用Kubernetes客户端删除Job
        try:
            success, result = delete_job_with_kubernetes_client(job_id)
            
            if success:
                logger.info(f"成功删除Job: {result}")
            else:
                logger.warning(f"删除Job失败: {result}")
                
        except Exception as e:
            logger.error(f"删除Job异常: {e}")
            return jsonify({"error": f"删除Job失败: {str(e)}"}), 500
        

        
        # 更新数据库状态
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                UPDATE diagnostic_jobs 
                SET status = 'stopped', completed_at = datetime('now', 'localtime')
                WHERE job_id = ?
            ''', (job_id,))
            
            conn.commit()
            conn.close()
            logger.info(f"Job状态已更新为stopped: {job_id}")
            
        except Exception as db_error:
            logger.error(f"更新Job状态失败: {db_error}")
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "stop_gpu_inspection_job", "allowed")
        
        return jsonify({
            "success": True,
            "message": f"Job {job_id} 已停止",
            "jobId": job_id
        })
        
    except Exception as e:
        logger.error(f"停止Job失败: {e}")
        return jsonify({
            "error": f"停止Job失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/check-job-status/<job_id>', methods=['POST'])
def manual_check_job_status(job_id):
    """手动检查指定Job的状态"""
    try:
        logger.info(f"手动检查Job状态: {job_id}")
        
        # 获取Kubernetes状态
        result = subprocess.run([
            'kubectl', 'get', 'jobs', '-n', 'gpu-health-expert',
            '--field-selector', f'metadata.labels.job-id={job_id}',
            '-o', 'jsonpath={.items[*].status.conditions[?(@.type=="Complete")].status}'
        ], capture_output=True, text=True, timeout=30)
        
        pod_status = 'unknown'
        if result.returncode == 0 and result.stdout.strip():
            if result.stdout.strip() == 'True':
                pod_status = 'completed'
            else:
                pod_status = 'running'
        
        logger.info(f"Job {job_id} 当前Kubernetes状态: {pod_status}")
        
        # 更新数据库状态
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE diagnostic_jobs 
            SET status = ?, updated_at = datetime('now', 'localtime')
            WHERE job_id = ?
        ''', (pod_status, job_id))
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "job_id": job_id,
            "status": pod_status,
            "message": f"Job状态已更新为: {pod_status}"
        })
        
    except Exception as e:
        logger.error(f"手动检查Job状态失败: {e}")
        return jsonify({
            "success": False,
            "job_id": job_id,
            "error": f"检查Job状态失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/node-status/all', methods=['GET'])
@get_rate_limit_decorator()  # 应用频率限制
def get_all_node_status():
    """获取所有节点状态 - 应用频率限制"""
    client_ip = request.remote_addr
    logger.info(f"执行命令: /usr/local/bin/kubectl-resource-view node -t gpu")
    
    try:
        # 执行kubectl命令 - 增加超时时间到2分钟
        result = subprocess.run([
            '/usr/local/bin/kubectl-resource-view', 'node', '-t', 'gpu'
        ], capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            logger.error(f"执行kubectl命令失败: {result.stderr}")
            return jsonify({
                "error": "执行kubectl命令失败",
                "stderr": result.stderr
            }), 500
        
        # 解析所有节点
        all_nodes = []
        for line in result.stdout.split('\n'):
            if line.strip() and '|' in line.strip():
                # 解析格式: | hd03-gpu2-0011 | 0 | 0% | 0 | 0% | nvidia.com/gpu-h200 |
                parts = [part.strip() for part in line.strip().split('|') if part.strip()]
                
                if len(parts) >= 6:
                    node_name = parts[0]
                    
                    # 过滤掉表头行（NODE, NVIDIA/GPU REQ等）
                    if node_name.upper() in ['NODE', 'NVIDIA/GPU REQ', 'NVIDIA/GPU REQ(%)', 'NVIDIA/GPU LIM', 'NVIDIA/GPU LIM(%)', 'GPU MODEL']:
                        logger.info(f"跳过表头行: {node_name}")
                        continue
                    
                    # 过滤掉不包含实际节点名称的行
                    if not node_name.startswith('hd03-gpu2-'):
                        logger.info(f"跳过非节点行: {node_name}")
                        continue
                    
                    gpu_requested = int(parts[1]) if parts[1].isdigit() else 0
                    gpu_utilization = parts[2]
                    gpu_available = int(parts[3]) if parts[3].isdigit() else 0
                    gpu_capacity = parts[4]
                    gpu_type = parts[5]
                    
                    all_nodes.append({
                        "nodeName": node_name,
                        "gpuRequested": gpu_requested,
                        "gpuUtilization": gpu_utilization,
                        "gpuAvailable": gpu_available,
                        "gpuCapacity": gpu_capacity,
                        "gpuType": gpu_type,
                        "rawLine": line.strip()
                    })
        
        logger.info(f"成功解析{len(all_nodes)}个节点")
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "get_all_node_status", "allowed")
        
        return jsonify({
            "success": True,
            "nodes": all_nodes,
            "total": len(all_nodes),
            "timestamp": time.time()
        })
        
    except subprocess.TimeoutExpired:
        logger.error("执行kubectl命令超时")
        return jsonify({
            "error": "执行kubectl命令超时"
        }), 500
    except Exception as e:
        logger.error(f"获取所有节点状态失败: {e}")
        return jsonify({
            "error": f"获取所有节点状态失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def save_diagnostic_result():
    """保存诊断结果 - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        # 验证必需字段
        required_fields = ['job_id', 'node_name', 'gpu_type', 'enabled_tests', 'dcgm_level', 'inspection_result', 'performance_pass', 'health_pass', 'execution_time', 'execution_log', 'benchmark_data', 'test_results']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"缺少必需字段: {field}"}), 400
        
        # 保存到数据库
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # 先检查记录是否存在
            cursor.execute('SELECT created_at FROM diagnostic_results WHERE job_id = ? AND node_name = ?', (data['job_id'], data['node_name']))
            existing_record = cursor.fetchone()
            
            if existing_record:
                # 记录存在，更新时保持原有created_at
                cursor.execute('''
                    UPDATE diagnostic_results 
                    SET job_type = ?, gpu_type = ?, enabled_tests = ?, dcgm_level = ?,
                        inspection_result = ?, performance_pass = ?, health_pass = ?,
                        execution_time = ?, execution_log = ?, benchmark_data = ?,
                        test_results = ?, expires_at = ?, updated_at = datetime('now', 'localtime')
                    WHERE job_id = ? AND node_name = ?
                ''', (
                    data.get('job_type', 'manual'), data['node_name'], data['gpu_type'],
                    json.dumps(data['enabled_tests']), data['dcgm_level'],
                    data['inspection_result'], data['performance_pass'], data['health_pass'],
                    data['execution_time'], data['execution_log'],
                    json.dumps(data['benchmark_data']), json.dumps(data['test_results']),
                    datetime.now() + timedelta(days=7), data['job_id'], data['node_name']
                ))
            else:
                # 记录不存在，插入新记录
                cursor.execute('''
                    INSERT INTO diagnostic_results 
                    (job_id, job_type, node_name, gpu_type, enabled_tests, dcgm_level, 
                     inspection_result, performance_pass, health_pass, execution_time, 
                     execution_log, benchmark_data, test_results, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ''', (
                    data['job_id'], data.get('job_type', 'manual'), data['node_name'],
                    data['gpu_type'], json.dumps(data['enabled_tests']), data['dcgm_level'],
                    data['inspection_result'], data['performance_pass'], data['health_pass'],
                    data['execution_time'], data['execution_log'],
                    json.dumps(data['benchmark_data']), json.dumps(data['test_results']),
                    datetime.now() + timedelta(days=7)
                ))
            
            # 同时更新Job状态为completed
            cursor.execute('''
                UPDATE diagnostic_jobs 
                SET status = 'completed', completed_at = datetime('now', 'localtime')
                WHERE job_id = ?
            ''', (data['job_id'],))
            
            conn.commit()
            logger.info(f"成功保存诊断结果并更新Job状态: {data['job_id']}")
            
            # 通知SSE客户端Job状态变化和诊断结果更新
            notify_job_status_change(data['job_id'], 'completed')
            notify_diagnostic_results_update()
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "save_diagnostic_result", "allowed")
        
        return jsonify({
            "success": True,
            "message": "诊断结果保存成功",
            "job_id": data['job_id']
        })
                
    except Exception as e:
        logger.error(f"保存诊断结果失败: {e}")
        return jsonify({
            "error": f"保存诊断结果失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results/<int:result_id>', methods=['GET'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def get_diagnostic_result_detail(result_id):
    """获取诊断结果详情 - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM diagnostic_results 
            WHERE id = ?
        ''', (result_id,))
        
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({"error": "诊断结果不存在"}), 404
        
        result_detail = {
            "id": result['id'],
            "jobId": result['job_id'],
            "jobType": result['job_type'],
            "nodeName": result['node_name'],
            "gpuType": result['gpu_type'],
            "enabledTests": json.loads(result['enabled_tests']) if result['enabled_tests'] else [],
            "dcgmLevel": result['dcgm_level'],
            "inspectionResult": result['inspection_result'],
            "performancePass": result['performance_pass'],
            "healthPass": result['health_pass'],
            "executionTime": result['execution_time'],
            "executionLog": result['execution_log'],
            "benchmarkData": json.loads(result['benchmark_data']) if result['benchmark_data'] else {},
            "testResults": json.loads(result['test_results']) if result['test_results'] else {},
            "createdAt": result['created_at']
        }
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "get_diagnostic_result_detail", "allowed")
        
        return jsonify({
            "success": True,
            "result": result_detail
        })
        
    except Exception as e:
        logger.error(f"获取诊断结果详情失败: {e}")
        return jsonify({
            "error": f"获取诊断结果详情失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results/delete', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def delete_diagnostic_results_by_job():
    """删除诊断结果 - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        job_ids = data.get('jobIds', [])
        if not job_ids:
            return jsonify({"error": "缺少要删除的Job ID列表"}), 400
        
        # 从数据库删除诊断结果
        conn = get_db_connection()
        cursor = conn.cursor()
        
        placeholders = ','.join(['?' for _ in job_ids])
        cursor.execute(f'''
            DELETE FROM diagnostic_results 
            WHERE job_id IN ({placeholders})
        ''', job_ids)
        
        deleted_count = cursor.rowcount
        conn.commit()
        conn.close()
        
        logger.info(f"成功删除{deleted_count}条诊断结果")
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "delete_diagnostic_results_by_job", "allowed")
        
        return jsonify({
            "success": True,
            "message": f"成功删除{deleted_count}条诊断结果",
            "deletedCount": deleted_count
        })
        
    except Exception as e:
        logger.error(f"删除诊断结果失败: {e}")
        return jsonify({
            "error": f"删除诊断结果失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/delete-diagnostic-result', methods=['POST'])
@get_rate_limit_decorator()
def delete_diagnostic_result():
    """删除指定的诊断结果"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        result_id = data.get('resultId')
        if not result_id:
            return jsonify({"error": "缺少结果ID参数"}), 400
        
        logger.info(f"开始删除诊断结果: {result_id}")
        
        # 从数据库中删除诊断结果
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # 先查询诊断结果信息，获取job_id
            cursor.execute('''
                SELECT job_id, node_name FROM diagnostic_results 
                WHERE id = ?
            ''', (result_id,))
            
            result_info = cursor.fetchone()
            
            if result_info:
                job_id = result_info[0]
                node_name = result_info[1]
                
                # 删除诊断结果
                cursor.execute("DELETE FROM diagnostic_results WHERE id = ?", (result_id,))
                result_deleted = cursor.rowcount > 0
                
                if result_deleted:
                    logger.info(f"诊断结果删除成功: ID={result_id}, Job={job_id}, 节点={node_name}")
                    
                    # 删除对应的PVC文件
                    try:
                        delete_pvc_files_for_job(job_id, node_name)
                        logger.info(f"PVC文件删除成功: Job={job_id}, 节点={node_name}")
                    except Exception as pvc_error:
                        logger.warning(f"PVC文件删除失败: Job={job_id}, 错误: {pvc_error}")
                    
                    conn.commit()
                    conn.close()
                    
                    return jsonify({
                        "success": True,
                        "message": f"诊断结果 {result_id} 删除成功",
                        "resultId": result_id
                    })
                else:
                    conn.close()
                    logger.warning(f"删除诊断结果失败: ID={result_id}")
                    return jsonify({"error": f"删除诊断结果失败: {result_id}"}), 500
            else:
                conn.close()
                logger.warning(f"未找到要删除的诊断结果: {result_id}")
                return jsonify({"error": f"未找到诊断结果: {result_id}"}), 404
            
        except Exception as e:
            logger.error(f"删除诊断结果失败: {e}")
            return jsonify({"error": f"删除诊断结果失败: {str(e)}"}), 500
        
    except Exception as e:
        logger.error(f"删除诊断结果异常: {e}")
        return jsonify({"error": f"删除诊断结果失败: {str(e)}"        }), 500

@app.route('/api/gpu-inspection/delete-diagnostic-results', methods=['POST'])
@get_rate_limit_decorator()
def delete_diagnostic_results():
    """批量删除指定的诊断结果"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求数据为空"}), 400
        
        result_ids = data.get('resultIds', [])
        if not result_ids or not isinstance(result_ids, list):
            return jsonify({"error": "缺少结果IDs参数或格式错误"}), 400
        
        logger.info(f"开始批量删除诊断结果: {result_ids}")
        
        deleted_results = []
        failed_results = []
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            for result_id in result_ids:
                try:
                    # 先查询节点名称，用于删除PVC文件
                    cursor.execute('''
                        SELECT node_name, job_id FROM diagnostic_results 
                        WHERE job_id = ?
                    ''', (result_id,))
                    
                    result_info = cursor.fetchone()
                    
                    if result_info:
                        node_name = result_info[0]
                        job_id = result_info[1]
                        
                        # 删除诊断结果
                        cursor.execute("DELETE FROM diagnostic_results WHERE job_id = ?", (result_id,))
                        result_deleted = cursor.rowcount > 0
                        
                        if result_deleted:
                            logger.info(f"诊断结果删除成功: Job={result_id}, 节点={node_name}")
                            
                            # 删除对应的PVC文件
                            try:
                                delete_pvc_files_for_job(job_id, node_name)
                                logger.info(f"PVC文件删除成功: Job={job_id}, 节点={node_name}")
                            except Exception as pvc_error:
                                logger.warning(f"PVC文件删除失败: Job={job_id}, 错误: {pvc_error}")
                            
                            deleted_results.append(result_id)
                        else:
                            logger.warning(f"删除诊断结果失败: Job={result_id}")
                            failed_results.append(result_id)
                    else:
                        logger.warning(f"未找到要删除的诊断结果: {result_id}")
                        failed_results.append(result_id)
                        
                except Exception as e:
                    logger.error(f"删除诊断结果 {result_id} 失败: {e}")
                    failed_results.append(result_id)
            
            conn.commit()
            conn.close()
            
            logger.info(f"批量删除完成: 成功={len(deleted_results)}, 失败={len(failed_results)}")
            
            return jsonify({
                "success": True,
                "message": f"批量删除完成: 成功{len(deleted_results)}个, 失败{len(failed_results)}个",
                "deletedResults": deleted_results,
                "failedResults": failed_results,
                "deletedCount": len(deleted_results),
                "failedCount": len(failed_results)
            })
            
        except Exception as e:
            conn.rollback()
            conn.close()
            raise e
        
    except Exception as e:
        logger.error(f"批量删除诊断结果失败: {e}")
        return jsonify({"error": f"批量删除诊断结果失败: {str(e)}"        }), 500

@app.route('/api/gpu-inspection/job-status/<job_id>', methods=['GET'])
@get_rate_limit_decorator()  # 应用频率限制
def get_job_status(job_id):
    """获取Job状态 - 应用频率限制"""
    client_ip = request.remote_addr
    
    try:
        # 首先尝试从数据库获取基础信息
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT job_id, job_name, job_type, status, created_at, started_at, completed_at, error_message
            FROM diagnostic_jobs 
            WHERE job_id = ?
        ''', (job_id,))
        
        job = cursor.fetchone()
        conn.close()
        
        if not job:
            return jsonify({"error": "Job不存在"}), 404
        
        # 通过kubectl获取真实的Kubernetes Job状态
        k8s_status = get_kubernetes_job_status(job_id)
        if k8s_status:
            pod_status = k8s_status['pod_status']
        else:
            # 如果无法获取Kubernetes状态，说明Job可能已被删除或不存在
            pod_status = 'unknown'
        
        # 如果Job已完成或失败，自动触发入库
        if (pod_status in ['Completed', 'Succeeded', 'Failed'] or 
            'Failed' in pod_status or 
            'Error' in pod_status):
            try:
                logger.info(f"检测到Job状态变化: {pod_status}，开始自动入库...")
                
                auto_collect_result = collector.collect_manual_results_from_pvc_internal()
                if auto_collect_result.get('success'):
                    logger.info(f"Job状态检查时自动入库成功: {auto_collect_result.get('processedCount', 0)} 个文件")
                    
                    # 入库成功后，立即通知前端刷新诊断结果
                    logger.info("入库成功，通知前端刷新诊断结果")
                    notify_diagnostic_results_update()
                else:
                    logger.warning(f"Job状态检查时自动入库失败: {auto_collect_result.get('error', '未知错误')}")
            except Exception as collect_error:
                logger.warning(f"Job状态检查时自动入库异常: {collect_error}")
        
        # 对于所有状态变化，都通知前端更新Job状态
        logger.info(f"Job状态: {job_id} -> {pod_status}")
        notify_job_status_change(job_id, pod_status)
        
        # 构建响应数据
        job_info = {
            "job_id": job['job_id'],
            "job_name": job['job_name'],
            "job_type": job['job_type'],
            "status": pod_status,  # 使用Kubernetes状态
            "created_at": job['created_at'],
            "started_at": job['started_at'],
            "completed_at": job['completed_at'],
            "error_message": job['error_message'],
            "k8s_status": {
                "pod_status": pod_status
            },
            "last_status_update": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "get_job_status", "allowed")
        
        return jsonify({
            "success": True,
            "job": job_info
        })
        
    except Exception as e:
        logger.error(f"获取Job状态失败: {e}")
        return jsonify({
            "error": f"获取Job状态失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/job-status-stream', methods=['GET'])
def job_status_stream():
    """SSE流端点 - 实时推送Job状态变化"""
    def generate():
        client_queue = queue.Queue()
        sse_clients.add(client_queue)
        logger.info(f"新的SSE客户端已连接，当前连接数: {len(sse_clients)}")
        
        try:
            # 发送连接确认
            yield f"data: {json.dumps({'type': 'connected', 'message': 'SSE连接已建立'})}\n\n"
            
            # 保持连接活跃，同时检查队列中的消息
            while True:
                try:
                    # 检查队列中是否有消息
                    try:
                        # 非阻塞方式检查队列
                        message = client_queue.get_nowait()
                        yield message
                    except queue.Empty:
                        # 队列为空，发送心跳
                        yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': time.time()})}\n\n"
                        time.sleep(30)  # 30秒心跳
                        
                except GeneratorExit:
                    break
                    
        except Exception as e:
            logger.error(f"SSE连接异常: {e}")
        finally:
            sse_clients.discard(client_queue)
            logger.info(f"SSE连接已关闭，当前连接数: {len(sse_clients)}")
    
    return app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        }
    )

@app.route('/api/gpu-inspection/sse-test', methods=['GET'])
def sse_test():
    """SSE连接测试端点"""
    try:
        test_message = {
            "type": "test",
            "message": "SSE连接测试成功",
            "timestamp": time.time()
        }
        
        # 尝试发送给所有SSE客户端
        if sse_clients:
            for client in sse_clients:
                try:
                    client.put(f"data: {json.dumps(test_message)}\n\n")
                except Exception as e:
                    logger.warning(f"发送测试消息失败: {e}")
            
            logger.info(f"已发送测试消息到 {len(sse_clients)} 个SSE客户端")
            return jsonify({
                "success": True,
                "message": f"测试消息已发送到 {len(sse_clients)} 个SSE客户端",
                "sse_clients_count": len(sse_clients)
            })
        else:
            logger.warning("没有SSE客户端连接")
            return jsonify({
                "success": False,
                "message": "没有SSE客户端连接",
                "sse_clients_count": 0
            })
            
    except Exception as e:
        logger.error(f"SSE连接测试失败: {e}")
        return jsonify({
            "success": False,
            "error": f"SSE连接测试失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/sse-status', methods=['GET'])
def get_sse_status():
    """获取SSE连接状态"""
    try:
        sse_status = {
            "clients_count": len(sse_clients) if sse_clients else 0,
            "clients_details": []
        }
        
        if sse_clients:
            for i, client in enumerate(sse_clients):
                try:
                    client_info = {
                        "client_id": i,
                        "type": type(client).__name__,
                        "queue_size": client.qsize() if hasattr(client, 'qsize') else "unknown"
                    }
                    sse_status["clients_details"].append(client_info)
                except Exception as e:
                    sse_status["clients_details"].append({
                        "client_id": i,
                        "error": str(e)
                    })
        
        return jsonify({
            "success": True,
            "sse_status": sse_status,
            "timestamp": time.time()
        })
        
    except Exception as e:
        logger.error(f"获取SSE状态失败: {e}")
        return jsonify({
            "error": f"获取SSE状态失败: {str(e)}"
        }), 500

# ============================================================================
# 健康检查和状态API
# ============================================================================
@app.route('/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'service': 'GHX (GPU Health Expert) Unified Service'
    })

@app.route('/api/gpu-inspection/health', methods=['GET'])
def gpu_inspection_health():
    """GPU检查服务健康检查"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'service': 'GHX GPU Health Expert Data Collector'
    })

@app.route('/api/gpu-inspection/status', methods=['GET'])
def get_status():
    """获取服务状态"""
    try:
        summary = collector.get_summary(24)
        return jsonify({
            'status': 'running',
            'timestamp': datetime.now().isoformat(),
            'lastUpdated': summary.get('lastUpdated'),
            'totalResults': summary.get('totalNodes', 0)
        })
        
    except Exception as e:
        logger.error(f"获取状态失败: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/rate-limit/stats', methods=['GET'])
def get_rate_limit_stats_api():
    """获取限流统计"""
    try:
        stats = get_rate_limit_stats()
        return jsonify(stats)
    except Exception as e:
        logger.error(f"获取限流统计失败: {e}")
        return jsonify({'error': str(e)        }), 500

@app.route('/api/gpu-inspection/collect-manual-results', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def collect_manual_results_from_pvc():
    """从PVC收集manual类型的诊断结果文件并入库"""
    client_ip = request.remote_addr
    
    try:
        logger.info("手动触发manual结果收集...")
        
        # 从PVC读取manual类型的文件
        manual_result = collector.collect_manual_results_from_pvc_internal()
        
        if manual_result.get('success'):
            # 通知SSE客户端诊断结果已更新
            notify_diagnostic_results_update()
            
            # 记录成功请求
            log_rate_limit_event(client_ip, "collect_manual_results_from_pvc", "allowed")
            
            return jsonify({
                "success": True,
                "message": f"成功处理 {manual_result.get('processedCount', 0)} 个manual结果文件",
                "processedCount": manual_result.get('processedCount', 0),
                "totalFiles": manual_result.get('totalFiles', 0)
            })
        else:
            return jsonify({
                "success": False,
                "error": manual_result.get('error', '未知错误')
            }), 500
                
    except Exception as e:
        logger.error(f"从PVC收集manual结果失败: {e}")
        return jsonify({
            "error": f"从PVC收集manual结果失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/thread-status', methods=['GET'])
def get_thread_status():
    """获取线程状态信息"""
    try:
        # 检查全局变量是否存在
        global_vars = {
            "status_check_thread_exists": 'status_check_thread' in globals(),
            "status_check_running_exists": 'status_check_running' in globals(),
            "sse_clients_exists": 'sse_clients' in globals()
        }
        
        # 获取线程状态
        thread_status = {
            "status_check_thread_alive": status_check_thread.is_alive() if status_check_thread else False,
            "status_check_running": status_check_running,
            "sse_clients_count": len(sse_clients) if sse_clients else 0
        }
        
        # 获取线程信息
        thread_info = {}
        if status_check_thread:
            thread_info = {
                "thread_id": status_check_thread.ident,
                "thread_name": status_check_thread.name,
                "is_alive": status_check_thread.is_alive(),
                "is_daemon": status_check_thread.daemon
            }
        
        return jsonify({
            "success": True,
            "global_vars": global_vars,
            "thread_status": thread_status,
            "thread_info": thread_info,
            "timestamp": time.time()
        })
        
    except Exception as e:
        logger.error(f"获取线程状态失败: {e}")
        return jsonify({
            "error": f"获取线程状态失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/results/cleanup', methods=['POST'])
@get_rate_limit_decorator()  # 应用1分钟频率限制
def cleanup_diagnostic_results():
    """清理过期诊断结果 - 应用1分钟频率限制"""
    client_ip = request.remote_addr
    
    try:
        # 清理过期数据
        cleanup_expired_data()
        
        # 记录成功请求
        log_rate_limit_event(client_ip, "cleanup_diagnostic_results", "allowed")
        
        return jsonify({
            "success": True,
            "message": "过期数据清理完成",
            "timestamp": time.time()
        })
        
    except Exception as e:
        logger.error(f"清理过期诊断结果失败: {e}")
        return jsonify({
            "error": f"清理过期诊断结果失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/gpu-resource-info', methods=['GET'])
def get_gpu_resource_info():
    """获取GPU资源信息"""
    try:
        gpu_resource_name = get_gpu_resource_name()
        return jsonify({
            "success": True,
            "gpuResourceName": gpu_resource_name,
            "timestamp": time.time()
        })
    except Exception as e:
        logger.error(f"获取GPU资源信息失败: {e}")
        return jsonify({
            "error": f"获取GPU资源信息失败: {str(e)}"
        }), 500

@app.route('/api/gpu-inspection/rdma-resource-info', methods=['GET'])
def get_rdma_resource_info():
    """获取RDMA资源信息"""
    try:
        rdma_resources = get_rdma_resources()
        return jsonify({
            "success": True,
            "rdmaResources": rdma_resources,
            "timestamp": time.time()
        })
    except Exception as e:
        logger.error(f"获取RDMA资源信息失败: {e}")
        return jsonify({
            "error": f"获取RDMA资源信息失败: {str(e)}"
        }), 500

def get_gpu_resource_name(node_name=None):
    """自动检测GPU资源名称 - 与自检专区保持一致的解析逻辑"""
    try:
        # 如果指定了节点名，只查询该节点
        if node_name:
            cmd = ['/usr/local/bin/kubectl-resource-view', 'node', node_name, '-t', 'gpu', '--no-format']
        else:
            cmd = ['/usr/local/bin/kubectl-resource-view', 'node', '-t', 'gpu']
        
        # 使用kubectl-resource-view获取GPU信息 - 增加超时时间到2分钟
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode == 0:
            # 使用与自检专区相同的解析逻辑
            lines = result.stdout.strip().split('\n')
            
            # 跳过表头行
            data_lines = lines[1:] if len(lines) > 1 else []
            
            for line in data_lines:
                if line.strip():
                    # 解析格式: hd03-gpu2-0011          0               0%                      0               0%                      nvidia.com/gpu-h200
                    import re
                    
                    # 使用正则表达式匹配节点名和GPU信息
                    match = re.match(r'^(\S+)\s+(\d+)\s+\d+%\s+(\d+)\s+\d+%\s+(nvidia\.com/gpu-\S+|amd\.com/gpu-\S+|N/A)', line)
                    
                    if match:
                        current_node_name = match.group(1)
                        gpu_type = match.group(4)
                        
                        # 过滤掉表头行和没有GPU的节点
                        if current_node_name.upper() in ['NODE', 'NVIDIA/GPU REQ', 'NVIDIA/GPU REQ(%)', 'NVIDIA/GPU LIM', 'NVIDIA/GPU LIM(%)', 'GPU MODEL']:
                            continue
                        
                        # 跳过没有GPU的节点
                        if gpu_type == 'N/A':
                            continue
                        
                        # 如果指定了节点名，只返回该节点的GPU类型
                        if node_name and current_node_name == node_name:
                            return gpu_type
                        # 如果没有指定节点名，返回第一个找到的GPU类型
                        elif not node_name and current_node_name.startswith('hd03-gpu2-'):
                            return gpu_type
        
        # 如果kubectl-resource-view失败，尝试使用kubectl describe nodes
        result = subprocess.run([
            'kubectl', 'describe', 'nodes'
        ], capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            lines = result.stdout.split('\n')
            for line in lines:
                if 'nvidia.com/gpu' in line:
                    # 提取GPU资源名称
                    parts = line.split()
                    for part in parts:
                        if part.startswith('nvidia.com/gpu'):
                            return part
                elif 'amd.com/gpu' in line:
                    # 提取AMD GPU资源名称
                    parts = line.split()
                    for part in parts:
                        if part.startswith('amd.com/gpu'):
                            return part
        
        # 默认返回nvidia.com/gpu
        return 'nvidia.com/gpu'
        
    except Exception as e:
        logger.warning(f"获取GPU资源名称失败: {e}")
        return 'nvidia.com/gpu'

def get_rdma_resources(node_name=None):
    """获取RDMA资源信息"""
    try:
        # 如果指定了节点名，只查询该节点
        if node_name:
            cmd = ['kubectl-resource-view', 'node', node_name, '-t', 'gpu', '--no-format']
        else:
            cmd = ['kubectl-resource-view', 'node', '-t', 'gpu']
        
        # 使用kubectl-resource-view获取RDMA信息
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            rdma_resources = []
            
            if node_name:
                # 单个节点模式：跳过表头，直接解析数据行
                data_lines = lines[1:] if len(lines) > 1 else []
            else:
                # 多节点模式：跳过表头
                data_lines = lines[1:] if len(lines) > 1 else []
            
            for line in data_lines:
                # 查找包含rdma/的行
                if 'rdma/' in line:
                    # 使用正则表达式提取rdma设备信息
                    import re
                    # 匹配所有 rdma/ 开头的设备: Y 格式，同时捕获设备名称和数量
                    matches = re.findall(r'rdma/([^:\s]+):\s*(\d+)', line)
                    
                    for match in matches:
                        device_name = f"rdma/{match[0]}"
                        count = int(match[1])
                        
                        if count > 0:  # 只添加有数量的设备
                            # 添加到资源列表，只返回资源名称
                            # 数量由用户在模板中定义
                            rdma_resources.append(device_name)
            
            if rdma_resources:
                # 去重：只保留唯一的设备名称
                unique_resources = list(set(rdma_resources))
                
                logger.info(f"发现 {len(rdma_resources)} 个RDMA设备，去重后 {len(unique_resources)} 个")
                # 返回去重后的资源名称列表，用逗号分隔
                return ','.join(unique_resources)
        
        # 如果kubectl-resource-view失败，返回空字符串（删除模板中的变量）
        logger.warning("无法获取RDMA资源信息，将删除模板中的RDMA资源配置")
        return ""
        
    except Exception as e:
        logger.error(f"获取RDMA资源失败: {e}")
        return ""


def cleanup_expired_data():
    """清理过期数据"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 清理过期的诊断结果
        cursor.execute('''
            DELETE FROM diagnostic_results 
            WHERE expires_at < datetime('now')
        ''')
        expired_results = cursor.rowcount
        
        # 清理过期的Job记录
        cursor.execute('''
            DELETE FROM diagnostic_jobs 
            WHERE expires_at < datetime('now')
        ''')
        expired_jobs = cursor.rowcount
        
        conn.commit()
        
        if expired_results > 0 or expired_jobs > 0:
            logger.info(f"清理过期数据完成: 诊断结果 {expired_results} 条, Job记录 {expired_jobs} 条")
        
    except Exception as e:
        logger.error(f"清理过期数据失败: {e}")
    finally:
        if conn:
            conn.close()

# ============================================================================
# 后台任务
# ============================================================================
def background_collection():
    """后台数据收集任务"""
    retention_days = int(os.environ.get('GPU_RESULT_RETENTION_DAYS', 7))
    while True:
        try:
            logger.info("执行后台数据收集...")
            # 收集cron类型的文件
            collector.collect_from_shared_pvc()
            # 收集manual类型的文件
            manual_result = collector.collect_manual_results_from_pvc_internal()
            if manual_result.get('success'):
                logger.info(f"manual文件收集成功: {manual_result.get('processedCount', 0)} 个文件")
            else:
                logger.warning(f"manual文件收集失败: {manual_result.get('error', '未知错误')}")
            
            collector.cleanup_old_files(retention_days)
            time.sleep(300)  # 每5分钟执行一次
        except Exception as e:
            logger.error(f"后台数据收集失败: {e}")
            time.sleep(60)  # 失败后1分钟重试

def init_shared_directories():
    """初始化共享目录"""
    try:
        # 创建必要的目录
        directories = [
            '/shared/gpu-inspection-results',
            '/shared/gpu-inspection-results/cron',
            '/shared/gpu-inspection-results/manual'
        ]
        
        for directory in directories:
            if not os.path.exists(directory):
                os.makedirs(directory, exist_ok=True)
                logger.info(f"创建目录: {directory}")
            else:
                logger.debug(f"目录已存在: {directory}")
        
        logger.info("共享目录初始化完成")
        
    except Exception as e:
        logger.error(f"初始化共享目录失败: {e}")

# ============================================================================
# 烧机测试相关API
# ============================================================================

# 烧机测试状态存储
burnin_jobs = {}  # job_id -> job_info
burnin_metrics = {}  # job_id -> gpu_metrics
burnin_clients = set()  # WebSocket客户端

@app.route('/api/burnin/create', methods=['POST'])
@get_rate_limit_decorator()
def create_burnin_job():
    """创建烧机测试Job"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': '请求数据不能为空'
            }), 400
        
        # 验证必需参数
        required_fields = ['nodeName', 'memoryType', 'memoryValue', 'duration']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'缺少必需参数: {field}'
                }), 400
        
        node_name = data['nodeName']
        memory_type = data['memoryType']  # 'fixed' or 'percentage'
        memory_value = data['memoryValue']
        duration = int(data['duration'])
        
        # 验证参数
        if memory_type not in ['fixed', 'percentage']:
            return jsonify({
                'success': False,
                'error': '内存类型必须是fixed或percentage'
            }), 400
        
        if memory_type == 'percentage' and (memory_value < 1 or memory_value > 100):
            return jsonify({
                'success': False,
                'error': '内存百分比必须在1-100之间'
            }), 400
        
        if memory_type == 'fixed' and (memory_value < 1 or memory_value > 100000):
            return jsonify({
                'success': False,
                'error': '固定内存值必须在1-100000MB之间'
            }), 400
        
        if duration < 60 or duration > 86400:  # 1分钟到24小时（秒）
            return jsonify({
                'success': False,
                'error': '测试时长必须在1-1440分钟之间'
            }), 400
        
        # 生成Job ID
        job_id = f"burnin-{int(time.time())}"
        
        # 构建内存参数
        if memory_type == 'percentage':
            memory_param = f"{memory_value}%"
        else:
            memory_param = f"{memory_value}MB"
        
        # 获取GPU资源名称
        gpu_resource_name = get_gpu_resource_name(node_name)
        if not gpu_resource_name:
            return jsonify({
                'success': False,
                'error': f'无法获取节点 {node_name} 的GPU资源名称'
            }), 400
        
        # 创建Job
        job_info = {
            'job_id': job_id,
            'node_name': node_name,
            'memory_type': memory_type,
            'memory_value': memory_value,
            'memory_param': memory_param,
            'duration': duration,
            'status': 'creating',
            'created_at': datetime.now().isoformat(),
            'progress': 0.0,
            'gpu_metrics': {}
        }
        
        # 存储Job信息
        burnin_jobs[job_id] = job_info
        burnin_metrics[job_id] = []
        
        # 在后台线程中创建Kubernetes Job
        def create_k8s_job():
            try:
                success = create_burnin_k8s_job(job_info, gpu_resource_name)
                if success:
                    burnin_jobs[job_id]['status'] = 'running'
                    logger.info(f"烧机测试Job创建成功: {job_id}")
                else:
                    burnin_jobs[job_id]['status'] = 'failed'
                    logger.error(f"烧机测试Job创建失败: {job_id}")
            except Exception as e:
                burnin_jobs[job_id]['status'] = 'failed'
                logger.error(f"创建烧机测试Job异常: {e}")
        
        # 启动后台线程
        thread = threading.Thread(target=create_k8s_job)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': '烧机测试Job创建中...'
        })
        
    except Exception as e:
        logger.error(f"创建烧机测试Job失败: {e}")
        return jsonify({
            'success': False,
            'error': f'创建烧机测试Job失败: {str(e)}'
        }), 500

def create_burnin_k8s_job(job_info, gpu_resource_name):
    """创建Kubernetes烧机测试Job"""
    try:
        if not kubernetes_client:
            logger.error("Kubernetes客户端不可用")
            return False
        
        v1, batch_v1 = kubernetes_client
        
        # 从挂载的文件读取Job模板
        try:
            with open('/app/burnin-job-template.yaml', 'r', encoding='utf-8') as f:
                job_template = f.read()
            logger.info("从挂载文件成功读取烧机测试Job模板")
        except Exception as e:
            logger.error(f"从挂载文件读取烧机测试Job模板失败: {e}")
            # 回退到ConfigMap API读取
            try:
                configmap = v1.read_namespaced_config_map(
                    name='job-template-config',
                    namespace='gpu-health-expert'
                )
                job_template = configmap.data['burnin-job-template.yaml']
                logger.info("回退到ConfigMap API读取烧机测试Job模板")
            except Exception as configmap_e:
                logger.error(f"ConfigMap API读取也失败: {configmap_e}")
                # 最后回退到本地文件
                try:
                    with open('burnin-job-template.yaml', 'r', encoding='utf-8') as f:
                        job_template = f.read()
                    logger.info("最后回退到本地文件读取烧机测试Job模板")
                except Exception as file_e:
                    logger.error(f"所有读取方式都失败: {file_e}")
                    return False
        
        # 替换模板变量
        job_yaml = job_template.format(
            JOB_ID=job_info['job_id'],
            BASE_JOB_ID=job_info['job_id'],
            NODE_NAME=job_info['node_name'],
            MEMORY_PARAM=job_info['memory_param'],
            DURATION=job_info['duration'],
            GPU_RESOURCE_NAME=gpu_resource_name
        )
        
        # 解析YAML
        import yaml
        job_spec = yaml.safe_load(job_yaml)
        
        # 创建Job
        batch_v1.create_namespaced_job(
            namespace='gpu-health-expert',
            body=job_spec
        )
        
        logger.info(f"Kubernetes烧机测试Job创建成功: {job_info['job_id']}")
        return True
        
    except Exception as e:
        logger.error(f"创建Kubernetes烧机测试Job失败: {e}")
        return False

@app.route('/api/burnin/jobs', methods=['GET'])
@get_rate_limit_decorator()
def get_burnin_jobs():
    """获取烧机测试Job列表"""
    client_ip = request.remote_addr
    
    try:
        # 返回Job列表
        jobs = []
        for job_id, job_info in burnin_jobs.items():
            jobs.append({
                'job_id': job_id,
                'node_name': job_info['node_name'],
                'memory_param': job_info['memory_param'],
                'duration': job_info['duration'],
                'status': job_info['status'],
                'progress': job_info['progress'],
                'created_at': job_info['created_at'],
                'gpu_count': len(job_info['gpu_metrics'])
            })
        
        # 按创建时间倒序排列
        jobs.sort(key=lambda x: x['created_at'], reverse=True)
        
        return jsonify({
            'success': True,
            'jobs': jobs
        })
        
    except Exception as e:
        logger.error(f"获取烧机测试Job列表失败: {e}")
        return jsonify({
            'success': False,
            'error': f'获取烧机测试Job列表失败: {str(e)}'
        }), 500

@app.route('/api/burnin/jobs/<job_id>', methods=['GET'])
@get_rate_limit_decorator()
def get_burnin_job_status(job_id):
    """获取烧机测试Job状态"""
    client_ip = request.remote_addr
    
    try:
        if job_id not in burnin_jobs:
            return jsonify({
                'success': False,
                'error': 'Job不存在'
            }), 404
        
        job_info = burnin_jobs[job_id]
        
        return jsonify({
            'success': True,
            'job': job_info
        })
        
    except Exception as e:
        logger.error(f"获取烧机测试Job状态失败: {e}")
        return jsonify({
            'success': False,
            'error': f'获取烧机测试Job状态失败: {str(e)}'
        }), 500

@app.route('/api/burnin/stop', methods=['POST'])
@get_rate_limit_decorator()
def stop_burnin_job():
    """停止烧机测试Job"""
    client_ip = request.remote_addr
    
    try:
        data = request.get_json()
        if not data or 'job_id' not in data:
            return jsonify({
                'success': False,
                'error': '缺少job_id参数'
            }), 400
        
        job_id = data['job_id']
        
        if job_id not in burnin_jobs:
            return jsonify({
                'success': False,
                'error': 'Job不存在'
            }), 404
        
        # 更新Job状态
        burnin_jobs[job_id]['status'] = 'stopping'
        
        # 删除Kubernetes Job
        success = delete_job_with_kubernetes_client(job_id)
        
        if success:
            burnin_jobs[job_id]['status'] = 'stopped'
            logger.info(f"烧机测试Job停止成功: {job_id}")
        else:
            burnin_jobs[job_id]['status'] = 'stop_failed'
            logger.error(f"烧机测试Job停止失败: {job_id}")
        
        return jsonify({
            'success': success,
            'message': '烧机测试Job停止成功' if success else '烧机测试Job停止失败'
        })
        
    except Exception as e:
        logger.error(f"停止烧机测试Job失败: {e}")
        return jsonify({
            'success': False,
            'error': f'停止烧机测试Job失败: {str(e)}'
        }), 500

@app.route('/api/burnin/metrics', methods=['POST'])
def receive_burnin_metrics():
    """接收烧机测试指标"""
    try:
        data = request.get_json()
        logger.info(f"收到烧机测试指标数据: {data}")
        
        if not data:
            return jsonify({
                'success': False,
                'error': '请求数据不能为空'
            }), 400
        
        job_id = data.get('job_id')
        if not job_id:
            return jsonify({
                'success': False,
                'error': '缺少job_id参数'
            }), 400
        
        # 更新Job指标
        if job_id in burnin_jobs:
            # 更新整个节点数据
            burnin_jobs[job_id].update({
                'progress': data.get('progress', 0),
                'gpus': data.get('gpus', []),
                'total_gflops': data.get('total_gflops', 0),
                'total_errors': data.get('total_errors', 0),
                'avg_temperature': data.get('avg_temperature', 0),
                'gpu_count': data.get('gpu_count', 0),
                'last_update': data.get('timestamp', datetime.now().isoformat())
            })
            
            # 更新状态
            if data.get('status') == 'completed':
                burnin_jobs[job_id]['status'] = 'completed'
            elif data.get('status') == 'failed':
                burnin_jobs[job_id]['status'] = 'failed'
        
        # 存储到指标历史
        if job_id not in burnin_metrics:
            burnin_metrics[job_id] = []
        
        burnin_metrics[job_id].append({
            'timestamp': datetime.now().isoformat(),
            'data': data
        })
        
        # 保持最近1000条记录
        if len(burnin_metrics[job_id]) > 1000:
            burnin_metrics[job_id] = burnin_metrics[job_id][-1000:]
        
        # 通知WebSocket客户端
        notify_burnin_status_change(job_id, 'metrics_update', data)
        
        return jsonify({
            'success': True,
            'message': '指标接收成功'
        })
        
    except Exception as e:
        logger.error(f"接收烧机测试指标失败: {e}")
        return jsonify({
            'success': False,
            'error': f'接收烧机测试指标失败: {str(e)}'
        }), 500

@app.route('/api/burnin/stream', methods=['GET'])
def burnin_status_stream():
    """烧机测试状态流"""
    def generate():
        client_queue = queue.Queue()
        burnin_clients.add(client_queue)
        logger.info(f"新的烧机测试SSE客户端已连接，当前连接数: {len(burnin_clients)}")
        
        try:
            while True:
                try:
                    # 发送心跳
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now().isoformat()})}\n\n"
                    
                    # 检查队列中的消息
                    try:
                        message = client_queue.get(timeout=30)
                        yield f"data: {json.dumps(message)}\n\n"
                    except queue.Empty:
                        continue
                        
                except Exception as e:
                    logger.error(f"烧机测试SSE流错误: {e}")
                    break
        finally:
            burnin_clients.discard(client_queue)
            logger.info(f"烧机测试SSE客户端断开连接，当前连接数: {len(burnin_clients)}")
    
    return Response(generate(), mimetype='text/event-stream')

def notify_burnin_status_change(job_id, status, data=None):
    """通知烧机测试状态变化"""
    global burnin_clients
    
    message = {
        "type": "burnin_status_change",
        "job_id": job_id,
        "status": status,
        "timestamp": datetime.now().isoformat(),
        "data": data or {}
    }
    
    # 发送给所有连接的客户端
    for client_queue in list(burnin_clients):
        try:
            client_queue.put(message)
        except Exception as e:
            logger.error(f"发送烧机测试状态变化通知失败: {e}")
            burnin_clients.discard(client_queue)

if __name__ == '__main__':
    # 初始化数据库
    init_db()
    
    # 初始化共享目录
    init_shared_directories()
    
    # 启动后台收集任务
    collection_thread = threading.Thread(target=background_collection, daemon=True)
    collection_thread.start()
    
    # 启动状态检查线程（多方案备选）
    start_status_check_thread()
    
    # 启动Flask应用
    logger.info("启动GHX (GPU Health Expert) 统一服务...")
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,
        threaded=True
    )
