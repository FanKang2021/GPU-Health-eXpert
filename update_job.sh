#!/bin/bash

# 设置CronJob的命名空间和名称
NAMESPACE="gpu-health-expert"
CRONJOB_NAME="ghx-cronjob"

# 获取空闲GPU节点数量的函数
get_free_gpu_nodes() {
    # 使用kubectl命令获取未使用GPU的节点数量
    # 假设每个节点有8个GPU，我们只关心节点是否完全空闲
    free_gpu_nodes=$(kubectl-resource-view node -t gpu --no-format | grep gpu | awk '$2==0 && $4==0 {print $1}' | wc -l)
    
    echo $free_gpu_nodes
}

# 更新CronJob的函数
update_cronjob() {
    local free_gpu_nodes=$1
    local completions=$free_gpu_nodes
    local parallelism=$free_gpu_nodes

    # 使用kubectl patch命令更新CronJob
    kubectl patch cronjob $CRONJOB_NAME -n $NAMESPACE --type='json' -p='[{"op": "replace", "path": "/spec/jobTemplate/spec/completions", "value": '$completions'},{"op": "replace", "path": "/spec/jobTemplate/spec/parallelism", "value": '$parallelism'}]'
    
    echo "$(date '+%Y-%m-%d %H:%M:%S') CronJob updated: completions=$completions, parallelism=$parallelism"
}

# 获取空闲GPU节点数量并更新CronJob
free_gpu_nodes=$(get_free_gpu_nodes)
update_cronjob $free_gpu_nodes
