#!/usr/bin/env python3
"""
GPU Burn-in Monitor
监控gpu_burn输出并直接发送到API的脚本
"""

import json
import subprocess
import os
import sys
import time
import threading
import logging
import requests
from datetime import datetime
from typing import Dict, Any, List
import re

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger(__name__)

# 强制刷新输出缓冲区
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

class GPUBurninMonitor:
    """GPU烧机监控器"""
    
    def __init__(self):
        self.job_id = os.environ.get('JOB_ID', 'unknown')
        self.node_name = os.environ.get('NODE_NAME', 'unknown')
        self.pod_name = os.environ.get('POD_NAME', 'unknown')
        self.memory_param = os.environ.get('MEMORY_PARAM', '80%')
        self.duration = int(os.environ.get('DURATION', '30'))
        self.api_server_url = os.environ.get('API_SERVER_URL', 'http://localhost:5000')
        
        # 调试信息：打印所有环境变量
        logger.info(f"环境变量检查:")
        logger.info(f"  JOB_ID: {self.job_id}")
        logger.info(f"  NODE_NAME: {self.node_name}")
        logger.info(f"  POD_NAME: {self.pod_name}")
        logger.info(f"  MEMORY_PARAM: {self.memory_param}")
        logger.info(f"  DURATION: {self.duration}")
        logger.info(f"  API_SERVER_URL: {self.api_server_url}")
        
        # 检查API_SERVER_URL是否正确设置
        if self.api_server_url == 'http://localhost:5000':
            logger.error("警告: API_SERVER_URL 使用默认值 localhost:5000，可能环境变量未正确设置！")
        else:
            logger.info(f"API_SERVER_URL 已正确设置为: {self.api_server_url}")
        
        # 切换到gpu-burn工作目录
        try:
            os.chdir('/opt/gpu-burn')
            logger.info(f"切换到工作目录: {os.getcwd()}")
        except Exception as e:
            logger.warning(f"无法切换到/opt/gpu-burn目录: {e}")
            logger.info(f"当前工作目录: {os.getcwd()}")
        
        # 监控状态
        self.is_running = False
        self.start_time = None
        self.gpu_metrics = {}
        self.last_send_time = 0
        self.send_interval = 10  # 每10秒发送一次数据，避免频率过高
        
        # 正则表达式模式 - 基于实际gpu_burn输出格式
        self.patterns = {
            'progress': r'(\d+\.?\d*)%',  # 进度百分比
            'gflops_list': r'\((\d+\.?\d*)\s*Gflop/s\)',  # GFlop/s列表
            'errors_list': r'errors:\s*([\d\s\-]+)',  # 错误列表
            'temps_list': r'temps:\s*([\d\s\-C]+)',  # 温度列表
            'memory_usage': r'(\d+\.?\d*)\s*MB',  # 内存使用
        }
    
    def parse_gpu_burn_output(self, line: str) -> Dict[str, Any]:
        """解析gpu_burn输出行 - 基于实际输出格式"""
        try:
            # 清理输出行
            line = line.strip()
            if not line:
                return None
            
            # 检查是否包含进度信息（主要数据行）
            progress_match = re.search(self.patterns['progress'], line)
            if not progress_match:
                return None
            
            progress = float(progress_match.group(1))
            
            # 提取GFlop/s列表
            gflops_matches = re.findall(self.patterns['gflops_list'], line)
            gflops_list = [float(x) for x in gflops_matches]
            
            # 提取错误列表
            errors_match = re.search(self.patterns['errors_list'], line)
            errors_list = []
            if errors_match:
                errors_str = errors_match.group(1)
                errors_list = [int(x.strip()) for x in errors_str.split('-') if x.strip().isdigit()]
            
            # 提取温度列表
            temps_match = re.search(self.patterns['temps_list'], line)
            temps_list = []
            if temps_match:
                temps_str = temps_match.group(1)
                # 提取温度数字
                temp_numbers = re.findall(r'(\d+)', temps_str)
                temps_list = [int(x) for x in temp_numbers]
            
            # 构建GPU数据
            gpus = []
            for i in range(len(gflops_list)):
                gpu_data = {
                    'id': i,
                    'gflops': gflops_list[i] if i < len(gflops_list) else 0.0,
                    'errors': errors_list[i] if i < len(errors_list) else 0,
                    'temperature': temps_list[i] if i < len(temps_list) else 0
                }
                gpus.append(gpu_data)
            
            # 计算总体指标
            total_gflops = sum(gflops_list)
            total_errors = sum(errors_list)
            avg_temp = sum(temps_list) / len(temps_list) if temps_list else 0
            
            metrics = {
                'timestamp': datetime.now().isoformat(),
                'node_name': self.node_name,
                'job_id': self.job_id,
                'progress': progress,
                'gpus': gpus,
                'total_gflops': total_gflops,
                'total_errors': total_errors,
                'avg_temperature': round(avg_temp, 1),
                'gpu_count': len(gpus)
            }
            
            return metrics
            
        except Exception as e:
            logger.error(f"解析gpu_burn输出失败: {e}, 行: {line}")
            return None
    
    def send_to_api(self, metrics: Dict[str, Any]):
        """直接发送指标到API服务器"""
        max_retries = 3
        retry_delay = 1  # 秒
        
        for attempt in range(max_retries):
            try:
                logger.info(f"发送指标到API (尝试 {attempt + 1}/{max_retries}): {self.api_server_url}/api/burnin/metrics")
                logger.info(f"发送的数据: {metrics}")
                
                response = requests.post(
                    f"{self.api_server_url}/api/burnin/metrics",
                    json=metrics,
                    timeout=30  # 增加超时时间到30秒
                )
                
                if response.status_code == 200:
                    print(f"✅ 成功发送指标到API: Job {metrics.get('job_id')}", flush=True)
                    logger.info(f"成功发送指标到API: Job {metrics.get('job_id')}")
                    return True
                else:
                    print(f"❌ 发送到API失败: {response.status_code}, 响应: {response.text}, 尝试 {attempt + 1}/{max_retries}", flush=True)
                    logger.warning(f"发送到API失败: {response.status_code}, 响应: {response.text}, 尝试 {attempt + 1}/{max_retries}")
                    
            except requests.exceptions.RequestException as e:
                logger.warning(f"发送到API失败 (尝试 {attempt + 1}/{max_retries}): {e}")
            except Exception as e:
                logger.error(f"发送到API时发生未知错误: {e}")
                break
            
            # 如果不是最后一次尝试，等待后重试
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
                retry_delay *= 2  # 指数退避
        
        logger.error(f"发送到API失败，已重试 {max_retries} 次")
        return False
    
    def should_send_data(self) -> bool:
        """判断是否应该发送数据 (限流)"""
        current_time = time.time()
        if current_time - self.last_send_time >= self.send_interval:
            self.last_send_time = current_time
            return True
        return False
    
    def monitor_gpu_burn(self):
        """监控gpu_burn进程"""
        try:
            # 构建gpu_burn命令
            cmd = ['/opt/gpu-burn/gpu_burn', '-m', self.memory_param, '-d', str(self.duration)]
            
            logger.info(f"启动gpu_burn: {' '.join(cmd)}")
            
            # 启动gpu_burn进程
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1
            )
            
            self.is_running = True
            self.start_time = datetime.now()
            
            # 实时读取输出
            for line in iter(process.stdout.readline, ''):
                if not self.is_running:
                    break
                
                # 解析输出
                metrics = self.parse_gpu_burn_output(line)
                if metrics:
                    # 更新GPU指标（存储整个节点数据）
                    self.gpu_metrics['node_data'] = metrics
                    
                    # 限流发送到API
                    if self.should_send_data():
                        print(f"=== 准备发送数据到API ===", flush=True)
                        # 发送完整数据
                        self.send_to_api(metrics)
                
                # 打印原始输出（用于调试）
                print(line, end='', flush=True)
            
            # 等待进程结束
            return_code = process.wait()
            
            logger.info(f"gpu_burn进程结束，返回码: {return_code}")
            
            # 发送最终状态
            self.send_final_status(return_code)
            
        except Exception as e:
            logger.error(f"监控gpu_burn失败: {e}")
            self.send_final_status(-1)
    
    def send_final_status(self, return_code: int):
        """发送最终状态"""
        try:
            final_metrics = {
                'job_id': self.job_id,
                'node_name': self.node_name,
                'status': 'completed' if return_code == 0 else 'failed',
                'return_code': return_code,
                'end_time': datetime.now().isoformat(),
                'duration': self.duration,
                'memory_param': self.memory_param,
                'gpu_count': len(self.gpu_metrics),
                'final_gpu_metrics': self.gpu_metrics
            }
            
            # 发送到API
            self.send_to_api(final_metrics)
            
            logger.info(f"烧机测试完成: {final_metrics['status']}")
            
        except Exception as e:
            logger.error(f"发送最终状态失败: {e}")
    
    def run(self):
        """运行监控器"""
        try:
            logger.info(f"开始GPU烧机监控 - Job ID: {self.job_id}, 节点: {self.node_name}")
            logger.info(f"参数: 内存={self.memory_param}, 时长={self.duration}分钟")
            
            # 启动监控
            self.monitor_gpu_burn()
            
        except KeyboardInterrupt:
            logger.info("收到中断信号，停止监控")
            self.is_running = False
        except Exception as e:
            logger.error(f"监控器运行失败: {e}")
            sys.exit(1)

def main():
    """主函数"""
    monitor = GPUBurninMonitor()
    monitor.run()

if __name__ == "__main__":
    main()
