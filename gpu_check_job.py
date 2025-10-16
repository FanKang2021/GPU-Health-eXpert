#!/usr/bin/env python3
"""
GPU Node Inspection Job
K8s CronJob使用的GPU检查脚本，运行检查并将结果写入共享PVC
支持通过环境变量自定义选择检查项目
"""

import json
import subprocess
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, Any, List
import logging

BENCHMARKS_CONFIG_PATH = '/config/gpu-benchmarks.json'

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger(__name__)

# 强制刷新输出缓冲区
import sys
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# 结果输出路径
RESULTS_DIR = '/shared/gpu-inspection-results'

# 默认GPU基准值
GPU_BENCHMARKS = {
    "RTX 3090": {"p2p": 18, "nccl": 7, "bw": 20},
    "L40S": {"p2p": 28, "nccl": 9, "bw": 20},
    "RTX 4090": {"p2p": 18, "nccl": 7, "bw": 20},
    "A100": {"p2p": 420, "nccl": 70, "bw": 20},
    "A800": {"p2p": 340, "nccl": 55, "bw": 20},
    "H100": {"p2p": 700, "nccl": 139, "bw": 40},
    "H800": {"p2p": 340, "nccl": 65, "bw": 47},
    "H20": {"p2p": 700, "nccl": 139, "bw": 47},
    "H200": {"p2p": 730, "nccl": 145, "bw": 54}
}

def load_benchmarks_from_config():
    """从配置文件加载GPU基准值"""
    if os.path.exists(BENCHMARKS_CONFIG_PATH):
        try:
            with open(BENCHMARKS_CONFIG_PATH, 'r', encoding='utf-8') as f:
                config_benchmarks = json.load(f)
                GPU_BENCHMARKS.update(config_benchmarks)
        except Exception as e:
            logger.error(f"加载GPU基准值失败: {e}")

load_benchmarks_from_config()

def get_test_configuration():
    """获取测试配置"""
    # 测试项目名称映射：前端名称 -> 脚本内部名称
    test_name_mapping = {
        "nvbandwidthTest": "bandwidth",
        "p2pBandwidthLatencyTest": "p2p", 
        "ncclTests": "nccl",
        "dcgmDiag": "dcgm",
        "ibCheck": "ib"
    }
    
    # 获取环境变量中的测试项目
    enabled_tests_env = os.environ.get("ENABLED_TESTS", "nvbandwidthTest,p2pBandwidthLatencyTest,ncclTests,dcgmDiag,ibCheck")
    
    # 将环境变量字符串转换为列表，并映射到内部名称
    enabled_tests_raw = [test.strip() for test in enabled_tests_env.split(",") if test.strip()]
    enabled_tests = []
    
    for test in enabled_tests_raw:
        if test in test_name_mapping:
            enabled_tests.append(test_name_mapping[test])
        else:
            # 如果名称不在映射中，直接使用（向后兼容）
            enabled_tests.append(test)
    
    config = {
        "enabled_tests": enabled_tests,
        "enabled_tests_original": enabled_tests_raw,  # 保存原始的前端名称
        "dcgm_level": int(os.environ.get("DCGM_DIAG_LEVEL", "1")),
        "job_type": os.environ.get("JOB_TYPE", "cron"),  # cronjob默认值改为cron
        "job_id": os.environ.get("JOB_ID", "unknown"),
        "selected_nodes": os.environ.get("SELECTED_NODES", "").split(",") if os.environ.get("SELECTED_NODES") else []
    }
    
    # 验证测试项目
    valid_tests = ["bandwidth", "p2p", "nccl", "dcgm", "ib"]
    config["enabled_tests"] = [test for test in config["enabled_tests"] if test in valid_tests]
    
    return config

class GPULogCollector:
    """GPU检查日志收集器"""
    
    def __init__(self):
        self.logs = []
        self.start_time = datetime.now()
    
    def add_log(self, message: str):
        """添加日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"{timestamp} - {message}"
        self.logs.append(log_entry)
    
    def get_execution_log(self) -> str:
        """获取执行日志"""
        return "\n".join(self.logs)
    
    def get_execution_time(self) -> str:
        """获取执行时间"""
        duration = datetime.now() - self.start_time
        return str(duration)

class GPUChecker:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.results = {}
        self.log_collector = GPULogCollector()
        
    def ensure_results_dir(self):
        """确保结果目录存在"""
        try:
            os.makedirs(RESULTS_DIR, exist_ok=True)
        except Exception as e:
            self.log_collector.add_log(f"创建结果目录失败: {e}")
            raise
        
    def save_result_to_pvc(self, result: Dict[str, Any]):
        """将结果保存到共享PVC，不负责数据库入库"""
        try:
            self.ensure_results_dir()
            
            # 根据job_type确定保存目录
            job_type = result.get('job_type', 'unknown')
            node_name = result.get('node_name', 'unknown')
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            
            if job_type == 'cron':
                # cron类型保存到cron目录
                save_dir = os.path.join(RESULTS_DIR, 'cron')
                filename = f"{node_name}_{timestamp}.json"
                latest_filename = f"{node_name}_latest.json"
            else:
                # manual类型保存到manual目录
                save_dir = os.path.join(RESULTS_DIR, 'manual')
                filename = f"{node_name}_{timestamp}.json"
                latest_filename = f"{node_name}_latest.json"
            
            # 确保目录存在
            os.makedirs(save_dir, exist_ok=True)
            
            # 写入时间戳文件
            filepath = os.path.join(save_dir, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            # 写入latest文件
            latest_file = os.path.join(save_dir, latest_filename)
            with open(latest_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            # 不保存到数据库，只保存到PVC，由gpu-cli服务负责入库
            print(f"结果已保存到PVC目录: {save_dir}")
            self.log_collector.add_log(f"结果已保存到PVC目录: {save_dir}")
            
        except Exception as e:
            error_msg = f"保存结果到PVC失败: {e}"
            print(error_msg)
            self.log_collector.add_log(error_msg)
            raise

    def get_gpu_type(self) -> str:
        """获取GPU类型"""
        try:
            result = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader,nounits'], 
                                  capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                gpu_name = result.stdout.strip().split('\n')[0]
                # 简化GPU名称匹配
                if 'H200' in gpu_name:
                    return 'H200'
                elif 'H100' in gpu_name:
                    return 'H100'
                elif 'H800' in gpu_name:
                    return 'H800'
                elif 'A100' in gpu_name:
                    return 'A100'
                elif 'A800' in gpu_name:
                    return 'A800'
                elif 'L40S' in gpu_name:
                    return 'L40S'
                elif 'RTX 3090' in gpu_name:
                    return 'RTX 3090'
                elif 'RTX 4090' in gpu_name:
                    return 'RTX 4090'
                else:
                    return gpu_name
            else:
                logger.error(f"获取GPU类型失败: {result.stderr}")
                return "Unknown"
        except Exception as e:
            logger.error(f"获取GPU类型异常: {e}")
            return "Unknown"

    def run_bandwidth_test(self) -> Dict[str, Any]:
        """运行带宽测试 - 使用nvbandwidth工具"""
        if "bandwidth" not in self.config["enabled_tests"]:
            return {"value": "Skipped", "raw_value": 0, "status": "skipped"}
            
        try:
            print("=== 开始带宽测试 (使用nvbandwidth工具) ===")
            self.log_collector.add_log("=== 开始带宽测试 (使用nvbandwidth工具) ===")
            sys.stdout.flush()
            
            # 运行host_to_device_memcpy_ce测试
            cmd_h2d = "/usr/bin/nvbandwidth -t host_to_device_memcpy_ce"
            print(f"执行Host to Device命令: {cmd_h2d}")
            self.log_collector.add_log(f"执行Host to Device命令: {cmd_h2d}")
            sys.stdout.flush()
            
            print("正在执行Host to Device带宽测试，请稍候...")
            self.log_collector.add_log("正在执行Host to Device带宽测试，请稍候...")
            sys.stdout.flush()
            
            result_h2d = subprocess.run(cmd_h2d, shell=True, capture_output=True, text=True, timeout=300)
            
            print(f"Host to Device测试命令执行完成，返回码: {result_h2d.returncode}")
            self.log_collector.add_log(f"Host to Device测试命令执行完成，返回码: {result_h2d.returncode}")
            sys.stdout.flush()
            
            # 运行device_to_host_memcpy_ce测试
            cmd_d2h = "/usr/bin/nvbandwidth -t device_to_host_memcpy_ce"
            print(f"执行Device to Host命令: {cmd_d2h}")
            self.log_collector.add_log(f"执行Device to Host命令: {cmd_d2h}")
            sys.stdout.flush()
            
            print("正在执行Device to Host带宽测试，请稍候...")
            self.log_collector.add_log("正在执行Device to Host带宽测试，请稍候...")
            sys.stdout.flush()
            
            result_d2h = subprocess.run(cmd_d2h, shell=True, capture_output=True, text=True, timeout=300)
            
            print(f"Device to Host测试命令执行完成，返回码: {result_d2h.returncode}")
            self.log_collector.add_log(f"Device to Host测试命令执行完成，返回码: {result_d2h.returncode}")
            sys.stdout.flush()
                
            # 显示命令的真实输出
            if result_h2d.stdout:
                print("=== Host to Device测试命令输出 ===")
                self.log_collector.add_log("=== Host to Device测试命令输出 ===")
                print(result_h2d.stdout)
                self.log_collector.add_log(result_h2d.stdout)
                sys.stdout.flush()
            
            if result_d2h.stdout:
                print("=== Device to Host测试命令输出 ===")
                self.log_collector.add_log("=== Device to Host测试命令输出 ===")
                print(result_d2h.stdout)
                self.log_collector.add_log(result_d2h.stdout)
                sys.stdout.flush()
            
            if result_h2d.stderr:
                print("=== Host to Device测试命令错误输出 ===")
                self.log_collector.add_log("=== Host to Device测试命令错误输出 ===")
                print(result_h2d.stderr)
                self.log_collector.add_log(result_h2d.stderr)
                sys.stdout.flush()
            
            if result_d2h.stderr:
                print("=== Device to Host测试命令错误输出 ===")
                self.log_collector.add_log("=== Device to Host测试命令错误输出 ===")
                print(result_d2h.stderr)
                self.log_collector.add_log(result_d2h.stderr)
                sys.stdout.flush()
            
            if result_h2d.returncode == 0 and result_d2h.returncode == 0:
                print("开始解析nvbandwidth测试结果...")
                self.log_collector.add_log("开始解析nvbandwidth测试结果...")
                sys.stdout.flush()
                
                # 解析Host to Device结果
                h2d_bandwidth = self._parse_nvbandwidth_bandwidth(result_h2d.stdout, "host_to_device_memcpy_ce")
                d2h_bandwidth = self._parse_nvbandwidth_bandwidth(result_d2h.stdout, "device_to_host_memcpy_ce")
                
                if h2d_bandwidth > 0 and d2h_bandwidth > 0:
                    # 取两个测试的最小值作为最终结果
                    min_bw = min(h2d_bandwidth, d2h_bandwidth)
                    result_msg = f"nvbandwidth测试完成: {min_bw:.1f} GB/s (H2D: {h2d_bandwidth:.1f}, D2H: {d2h_bandwidth:.1f})"
                    print(f"=== {result_msg} ===")
                    self.log_collector.add_log(result_msg)
                    sys.stdout.flush()
                    return {"value": f"{min_bw:.1f} GB/s", "raw_value": min_bw, "status": "completed"}
                else:
                    error_msg = "nvbandwidth测试解析失败"
                    print(f"=== {error_msg} ===")
                    self.log_collector.add_log(error_msg)
                    sys.stdout.flush()
                    return {"value": "解析失败", "raw_value": 0, "status": "failed"}
            else:
                error_msg = f"nvbandwidth测试失败，H2D返回码: {result_h2d.returncode}, D2H返回码: {result_d2h.returncode}"
                print(f"=== {error_msg} ===")
                self.log_collector.add_log(error_msg)
                if result_h2d.stderr:
                    print(f"H2D错误输出: {result_h2d.stderr}")
                    self.log_collector.add_log(f"H2D错误输出: {result_h2d.stderr}")
                if result_d2h.stderr:
                    print(f"D2H错误输出: {result_d2h.stderr}")
                    self.log_collector.add_log(f"D2H错误输出: {result_d2h.stderr}")
                sys.stdout.flush()
                return {"value": "测试失败", "raw_value": 0, "status": "failed"}
                
        except subprocess.TimeoutExpired:
            error_msg = "nvbandwidth测试超时"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": "测试超时", "raw_value": 0, "status": "timeout"}
        except Exception as e:
            error_msg = f"nvbandwidth测试异常: {str(e)}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": f"异常: {str(e)}", "raw_value": 0, "status": "error"}

    def _parse_nvbandwidth_bandwidth(self, output: str, test_type: str) -> float:
        """解析nvbandwidth输出中的内存拷贝带宽值"""
        try:
            lines = output.split('\n')
            bandwidth_values = []
            
            # 查找包含内存拷贝带宽值的行（如： 0     55.25     55.24     55.24...）
            for line in lines:
                line = line.strip()
                # 匹配格式：以数字开头（行号），后面跟着多个浮点数（实际的带宽数据行）
                if line and line[0].isdigit() and len(line.split()) >= 3:
                    parts = line.split()
                    # 确保第一个元素是数字（行号），第二个元素是浮点数（带宽值）
                    try:
                        row_num = int(parts[0])
                        # 跳过第一个元素（行号），解析后面的带宽值
                        line_values = []
                        for part in parts[1:]:
                            try:
                                value = float(part)
                                # 只接受合理的带宽值（10-1000 GB/s范围）
                                if 10.0 <= value <= 1000.0:
                                    line_values.append(value)
                            except ValueError:
                                break  # 遇到非数字就停止
                        
                        if line_values:
                            bandwidth_values.extend(line_values)
                            print(f"找到{test_type}内存拷贝带宽值: {line_values}")
                            self.log_collector.add_log(f"找到{test_type}内存拷贝带宽值: {line_values}")
                    except (ValueError, IndexError):
                        continue
            
            # 如果找到带宽值，返回最小值
            if bandwidth_values:
                min_bandwidth = min(bandwidth_values)
                print(f"{test_type}最小内存拷贝带宽: {min_bandwidth} GB/s")
                self.log_collector.add_log(f"{test_type}最小内存拷贝带宽: {min_bandwidth} GB/s")
                return min_bandwidth
            
            return 0.0
        except Exception as e:
            print(f"解析{test_type}内存拷贝带宽失败: {e}")
            self.log_collector.add_log(f"解析{test_type}内存拷贝带宽失败: {e}")
            return 0.0

    def run_p2p_test(self) -> Dict[str, Any]:
        """运行P2P测试"""
        if "p2p" not in self.config["enabled_tests"]:
            return {"value": "Skipped", "raw_value": 0, "status": "skipped"}
            
        try:
            print("=== 开始P2P测试 ===")
            self.log_collector.add_log("=== 开始P2P测试 ===")
            sys.stdout.flush()
            
            # 运行8个GPU的P2P测试 - 使用更兼容的语法
            cmd = "for i in 0 1 2 3 4 5 6 7; do echo \"=== Testing P2P GPU $i ===\"; /usr/bin/p2pBandwidthLatencyTest --device=$i; done"
            print(f"执行命令: {cmd}")
            self.log_collector.add_log(f"执行命令: {cmd}")
            sys.stdout.flush()
            
            print("正在执行P2P测试，请稍候...")
            self.log_collector.add_log("正在执行P2P测试，请稍候...")
            sys.stdout.flush()
            
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
            
            print(f"P2P测试命令执行完成，返回码: {result.returncode}")
            self.log_collector.add_log(f"P2P测试命令执行完成，返回码: {result.returncode}")
            sys.stdout.flush()
            
            # 显示命令的真实输出
            if result.stdout:
                print("=== P2P测试命令输出 ===")
                self.log_collector.add_log("=== P2P测试命令输出 ===")
                print(result.stdout)
                self.log_collector.add_log(result.stdout)
                sys.stdout.flush()
            
            if result.stderr:
                print("=== P2P测试命令错误输出 ===")
                self.log_collector.add_log("=== P2P测试命令错误输出 ===")
                print(result.stderr)
                self.log_collector.add_log(result.stderr)
                sys.stdout.flush()
            
            if result.returncode == 0:
                print("开始解析P2P测试结果...")
                self.log_collector.add_log("开始解析P2P测试结果...")
                sys.stdout.flush()
                
                # 根据参考代码解析输出
                lines = result.stdout.split('\n')
                p2pflag = 0
                index = 0
                p2plist = []
                
                for line_num, line in enumerate(lines):
                    # 查找Bidirectional P2P=Enabled矩阵开始
                    if "Bidirectional P2P=Enabled Bandwidth Matrix (GB/s)" in line:
                        p2pflag = 1
                        continue
                    
                    # 遇到P2P=Disabled Latency Matrix时停止
                    if "P2P=Disabled Latency Matrix (us)" in line:
                        break
                    
                    # 在矩阵范围内解析数值
                    if p2pflag == 1:
                        index += 1
                        if index >= 3:  # 跳过前两行（标题行）
                            line_parts = line.split()
                            if len(line_parts) > 1:
                                # 移除第一个元素（设备索引）
                                line_parts.pop(0)
                                
                                for i, part in enumerate(line_parts):
                                    try:
                                        p2p_value = float(part)
                                        p2plist.append(p2p_value)
                                        print(f"找到P2P值: {p2p_value} GB/s")
                                        self.log_collector.add_log(f"找到P2P值: {p2p_value} GB/s")
                                    except (ValueError, IndexError):
                                        continue
                
                # 根据参考代码：移除对角线元素（每9个元素移除第1个）
                if p2plist:
                    j = 0
                    for i in range(len(p2plist)):
                        if i % 9 == 0:
                            if i - j < len(p2plist):
                                p2plist.pop(i - j)
                                j += 1
                
                if p2plist:
                    # 根据参考代码：返回最小值
                    min_p2p = min(p2plist)
                    result_msg = f"P2P测试完成: {min_p2p:.1f} GB/s (最小值，基于{len(p2plist)}个有效值)"
                    print(f"=== {result_msg} ===")
                    self.log_collector.add_log(result_msg)
                    sys.stdout.flush()
                    return {"value": f"{min_p2p:.1f} GB/s", "raw_value": min_p2p, "status": "completed"}
                else:
                    error_msg = "P2P测试解析失败"
                    print(f"=== {error_msg} ===")
                    self.log_collector.add_log(error_msg)
                    sys.stdout.flush()
                    return {"value": "解析失败", "raw_value": 0, "status": "failed"}
            else:
                error_msg = f"P2P测试失败，返回码: {result.returncode}"
                print(f"=== {error_msg} ===")
                self.log_collector.add_log(error_msg)
                if result.stderr:
                    print(f"错误输出: {result.stderr}")
                    self.log_collector.add_log(f"错误输出: {result.stderr}")
                sys.stdout.flush()
                return {"value": "测试失败", "raw_value": 0, "status": "failed"}
                
        except subprocess.TimeoutExpired:
            error_msg = "P2P测试超时"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": "测试超时", "raw_value": 0, "status": "timeout"}
        except Exception as e:
            error_msg = f"P2P测试异常: {str(e)}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": f"异常: {str(e)}", "raw_value": 0, "status": "error"}

    def run_nccl_test(self) -> Dict[str, Any]:
        """运行NCCL测试"""
        if "nccl" not in self.config["enabled_tests"]:
            return {"value": "Skipped", "raw_value": 0, "status": "skipped"}
            
        try:
            print("=== 开始NCCL测试 ===")
            self.log_collector.add_log("=== 开始NCCL测试 ===")
            sys.stdout.flush()
            
            # 运行NCCL测试 - 修复路径
            cmd = "/opt/nccl-tests/build/all_reduce_perf -b 1024 -e 1G -f 2 -g 8"
            print(f"执行命令: {cmd}")
            self.log_collector.add_log(f"执行命令: {cmd}")
            sys.stdout.flush()
            
            print("正在执行NCCL测试，请稍候...")
            self.log_collector.add_log("正在执行NCCL测试，请稍候...")
            sys.stdout.flush()
            
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
            
            print(f"NCCL测试命令执行完成，返回码: {result.returncode}")
            self.log_collector.add_log(f"NCCL测试命令执行完成，返回码: {result.returncode}")
            sys.stdout.flush()
            
            # 显示命令的真实输出
            if result.stdout:
                print("=== NCCL测试命令输出 ===")
                self.log_collector.add_log("=== NCCL测试命令输出 ===")
                print(result.stdout)
                self.log_collector.add_log(result.stdout)
                sys.stdout.flush()
            
            if result.stderr:
                print("=== NCCL测试命令错误输出 ===")
                self.log_collector.add_log("=== NCCL测试命令错误输出 ===")
                print(result.stderr)
                self.log_collector.add_log(result.stderr)
                sys.stdout.flush()
            
            if result.returncode == 0:
                print("开始解析NCCL测试结果...")
                self.log_collector.add_log("开始解析NCCL测试结果...")
                sys.stdout.flush()
                
                # 根据参考代码解析输出
                lines = result.stdout.split('\n')
                nccl_bw = 0
                
                for line_num, line in enumerate(lines):
                    if "Avg bus bandwidth" in line:
                        try:
                            parts = line.split()
                            # 根据参考代码：使用索引5提取带宽值
                            if len(parts) > 5:
                                nccl_bw = float(parts[5])
                                print(f"找到NCCL带宽值: {nccl_bw} GB/s")
                                self.log_collector.add_log(f"找到NCCL带宽值: {nccl_bw} GB/s")
                            break
                        except (IndexError, ValueError) as e:
                            continue
                
                if nccl_bw > 0:
                    result_msg = f"NCCL测试完成: {nccl_bw:.1f} GB/s"
                    print(f"=== {result_msg} ===")
                    self.log_collector.add_log(result_msg)
                    sys.stdout.flush()
                    return {"value": f"{nccl_bw:.1f} GB/s", "raw_value": nccl_bw, "status": "completed"}
                else:
                    error_msg = "NCCL测试解析失败"
                    print(f"=== {error_msg} ===")
                    self.log_collector.add_log(error_msg)
                    sys.stdout.flush()
                    return {"value": "解析失败", "raw_value": 0, "status": "failed"}
            else:
                error_msg = f"NCCL测试失败，返回码: {result.returncode}"
                print(f"=== {error_msg} ===")
                self.log_collector.add_log(error_msg)
                if result.stderr:
                    print(f"错误输出: {result.stderr}")
                    self.log_collector.add_log(f"错误输出: {result.stderr}")
                sys.stdout.flush()
                return {"value": "测试失败", "raw_value": 0, "status": "failed"}
                
        except subprocess.TimeoutExpired:
            error_msg = "NCCL测试超时"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": "测试超时", "raw_value": 0, "status": "timeout"}
        except Exception as e:
            error_msg = f"NCCL测试异常: {str(e)}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return {"value": f"异常: {str(e)}", "raw_value": 0, "status": "error"}

    def run_dcgm_diag(self) -> str:
        """运行DCGM诊断"""
        if "dcgm" not in self.config["enabled_tests"]:
            return "Skipped"
            
        try:
            print(f"=== 开始DCGM诊断，级别: {self.config['dcgm_level']} ===")
            self.log_collector.add_log(f"=== 开始DCGM诊断，级别: {self.config['dcgm_level']} ===")
            sys.stdout.flush()
            
            # 根据级别设置合理的超时时间
            dcgm_timeouts = {
                1: 1800,  # 级别1: 30分钟
                2: 3600,  # 级别2: 1小时
                3: 7200,  # 级别3: 2小时
                4: 14400  # 级别4: 4小时
            }
            timeout = dcgm_timeouts.get(self.config["dcgm_level"], 1800)
            
            # 根据级别运行DCGM诊断
            if self.config["dcgm_level"] == 1:
                cmd = "dcgmi diag -r 1"
            elif self.config["dcgm_level"] == 2:
                cmd = "dcgmi diag -r 2"
            elif self.config["dcgm_level"] == 3:
                cmd = "dcgmi diag -r 3"
            elif self.config["dcgm_level"] == 4:
                cmd = "dcgmi diag -r 4"
            else:
                cmd = "dcgmi diag -r 1"
            
            print(f"开始执行DCGM诊断命令: {cmd}")
            self.log_collector.add_log(f"开始执行DCGM诊断命令: {cmd}")
            print(f"DCGM诊断超时设置: {timeout}秒 ({timeout//60}分钟)")
            self.log_collector.add_log(f"DCGM诊断超时设置: {timeout}秒 ({timeout//60}分钟)")
            sys.stdout.flush()
            
            print("正在执行DCGM诊断，请稍候...")
            self.log_collector.add_log("正在执行DCGM诊断，请稍候...")
            sys.stdout.flush()
            
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
            
            print(f"DCGM诊断命令执行完成，返回码: {result.returncode}")
            self.log_collector.add_log(f"DCGM诊断命令执行完成，返回码: {result.returncode}")
            sys.stdout.flush()
            
            # 显示命令的真实输出
            if result.stdout:
                print("=== DCGM诊断命令输出 ===")
                self.log_collector.add_log("=== DCGM诊断命令输出 ===")
                print(result.stdout)
                self.log_collector.add_log(result.stdout)
                sys.stdout.flush()
            
            if result.stderr:
                print("=== DCGM诊断命令错误输出 ===")
                self.log_collector.add_log("=== DCGM诊断命令错误输出 ===")
                print(result.stderr)
                self.log_collector.add_log(result.stderr)
                sys.stdout.flush()
            
            if result.returncode == 0:
                result_msg = f"DCGM诊断完成，级别{self.config['dcgm_level']}"
                print(f"=== {result_msg} ===")
                self.log_collector.add_log(result_msg)
                sys.stdout.flush()
                return "Pass"
            else:
                result_msg = f"DCGM诊断失败，级别{self.config['dcgm_level']}"
                print(f"=== {result_msg} ===")
                self.log_collector.add_log(result_msg)
                if result.stderr:
                    print(f"错误输出: {result.stderr}")
                    self.log_collector.add_log(f"错误输出: {result.stderr}")
                sys.stdout.flush()
                return "No Pass"
                
        except subprocess.TimeoutExpired:
            error_msg = f"DCGM诊断超时，级别{self.config['dcgm_level']}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return "No Pass"
        except Exception as e:
            error_msg = f"DCGM诊断异常: {str(e)}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return "No Pass"

    def run_ib_check(self) -> str:
        """运行IB健康检查"""
        if "ib" not in self.config["enabled_tests"]:
            return "Skipped"
            
        try:
            print("=== 开始IB健康检查 ===")
            self.log_collector.add_log("=== 开始IB健康检查 ===")
            sys.stdout.flush()
            
            # 设置必要的环境变量
            env = os.environ.copy()
            env['TERM'] = 'xterm'  # 设置TERM环境变量
            env['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/ib_health_check'
            
            # 运行IB健康检查 - 修复路径
            cmd = "/opt/ib_health_check.sh"
            print(f"执行命令: {cmd}")
            self.log_collector.add_log(f"执行命令: {cmd}")
            sys.stdout.flush()
            
            print("正在执行IB健康检查，请稍候...")
            self.log_collector.add_log("正在执行IB健康检查，请稍候...")
            sys.stdout.flush()
            
            result = subprocess.run(
                cmd, 
                shell=True, 
                capture_output=True, 
                text=True, 
                timeout=600,
                env=env
            )
            
            print(f"IB健康检查命令执行完成，返回码: {result.returncode}")
            self.log_collector.add_log(f"IB健康检查命令执行完成，返回码: {result.returncode}")
            sys.stdout.flush()
            
            # 显示命令的真实输出
            if result.stdout:
                print("=== IB健康检查命令输出 ===")
                self.log_collector.add_log("=== IB健康检查命令输出 ===")
                print(result.stdout)
                self.log_collector.add_log(result.stdout)
                sys.stdout.flush()
            
            if result.stderr:
                print("=== IB健康检查命令错误输出 ===")
                self.log_collector.add_log("=== IB健康检查命令错误输出 ===")
                print(result.stderr)
                self.log_collector.add_log(result.stderr)
                sys.stdout.flush()
            
            if result.returncode == 0:
                output = result.stdout
                print("开始解析IB健康检查结果...")
                self.log_collector.add_log("开始解析IB健康检查结果...")
                sys.stdout.flush()
                
                # 只要有"通过模块: 10/10"就算通过
                if '通过模块: 10/10' in output:
                    result_msg = "IB健康检查通过: 10/10"
                    print(f"=== {result_msg} ===")
                    self.log_collector.add_log(result_msg)
                    sys.stdout.flush()
                    return "Pass"
                else:
                    result_msg = "IB健康检查失败: 未找到10/10通过信息"
                    print(f"=== {result_msg} ===")
                    self.log_collector.add_log(result_msg)
                    if output:
                        print(f"输出内容: {output}")
                        self.log_collector.add_log(f"输出内容: {output}")
                    sys.stdout.flush()
                    return "No Pass"
            else:
                # 即使返回码非0，也检查输出中是否有成功信息
                output = result.stdout + result.stderr
                print("开始解析IB健康检查结果（非0返回码）...")
                self.log_collector.add_log("开始解析IB健康检查结果（非0返回码）...")
                sys.stdout.flush()
                
            if '通过模块: 10/10' in output:
                result_msg = "IB健康检查通过: 10/10 (忽略返回码)"
                print(f"=== {result_msg} ===")
                self.log_collector.add_log(result_msg)
                sys.stdout.flush()
                return "Pass"
            else:
                result_msg = "IB健康检查失败: 返回码非0且未找到10/10通过信息"
                print(f"=== {result_msg} ===")
                self.log_collector.add_log(result_msg)
                if output:
                    print(f"输出内容: {output}")
                    self.log_collector.add_log(f"输出内容: {output}")
                sys.stdout.flush()
                return "No Pass"
                
        except subprocess.TimeoutExpired:
            error_msg = "IB健康检查超时"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return "No Pass"
        except Exception as e:
            error_msg = f"IB健康检查异常: {str(e)}"
            print(f"=== {error_msg} ===")
            self.log_collector.add_log(error_msg)
            sys.stdout.flush()
            return "No Pass"

    def run_selected_tests(self) -> Dict[str, Any]:
        """运行选定的测试项目"""
        print(f"开始运行选定的GPU检查测试: {self.config.get('enabled_tests_original', self.config['enabled_tests'])}")
        self.log_collector.add_log(f"开始运行选定的GPU检查测试: {self.config.get('enabled_tests_original', self.config['enabled_tests'])}")
        
        # 获取主机名和节点信息
        hostname = subprocess.run(['hostname'], capture_output=True, text=True).stdout.strip()
        
        # 获取K8s节点信息
        node_name = os.environ.get('NODE_NAME', hostname)
        pod_name = os.environ.get('POD_NAME', 'unknown')
        
        # 获取GPU类型
        gpu_type = self.get_gpu_type()
        print(f"检测到GPU类型: {gpu_type}")
        self.log_collector.add_log(f"检测到GPU类型: {gpu_type}")
        
        # 运行选定的测试项目
        results = {}
        
        if "bandwidth" in self.config["enabled_tests"]:
            results["bandwidth"] = self.run_bandwidth_test()
            
        if "p2p" in self.config["enabled_tests"]:
            results["p2p"] = self.run_p2p_test()
            
        if "nccl" in self.config["enabled_tests"]:
            results["nccl"] = self.run_nccl_test()
            
        if "dcgm" in self.config["enabled_tests"]:
            results["dcgm"] = self.run_dcgm_diag()
            
        if "ib" in self.config["enabled_tests"]:
            results["ib"] = self.run_ib_check()
        
        # 检查性能是否达标（仅对性能测试项目）
        performance_tests = []
        if "bandwidth" in results:
            performance_tests.append(("bw", results["bandwidth"]))
        if "p2p" in results:
            performance_tests.append(("p2p", results["p2p"]))
        if "nccl" in results:
            performance_tests.append(("nccl", results["nccl"]))
        
        benchmark = GPU_BENCHMARKS.get(gpu_type, {"p2p": 0, "nccl": 0, "bw": 0})
        performance_pass = True
        
        for test_type, result in performance_tests:
            if result["status"] == "completed" and result["raw_value"] < benchmark.get(test_type, 0):
                performance_pass = False
                break
        
        # 计算最终结果
        final_result = {
            "job_id": self.config["job_id"],
            "job_type": self.config["job_type"],
            "node_name": node_name,
            "pod_name": pod_name,
            "hostname": hostname,
            "gpu_type": gpu_type,
            "enabled_tests": self.config["enabled_tests"],
            "dcgm_level": self.config["dcgm_level"],
            "test_results": results,
            "performance_pass": performance_pass,
            "benchmark": benchmark,
            "execution_time": self.log_collector.get_execution_time(),
            "execution_log": self.log_collector.get_execution_log(),
            "created_at": datetime.now().isoformat()
        }
        
        return final_result

def main():
    """主函数"""
    try:
        print("=== GPU检查任务开始 ===")
        
        # 获取测试配置
        config = get_test_configuration()
        print(f"测试配置: {{'enabled_tests': {config['enabled_tests_original']}, 'dcgm_level': {config['dcgm_level']}, 'job_type': '{config['job_type']}', 'job_id': '{config['job_id']}', 'selected_nodes': {config['selected_nodes']}}}")
        
        # 创建GPU检查器
        checker = GPUChecker(config)
        
        # 运行测试
        result = checker.run_selected_tests()
        
        # 保存结果到PVC
        checker.save_result_to_pvc(result)
        
        print("=== GPU检查完成，结果已保存到PVC ===")
        sys.exit(0)
        
    except Exception as e:
        error_msg = f"GPU检查失败: {e}"
        print(error_msg)
        sys.exit(1)

if __name__ == "__main__":
    main() 