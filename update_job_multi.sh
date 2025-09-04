#!/bin/bash

NAMESPACE="gpu-health-expert"

# 获取空闲GPU节点数量的函数
get_free_gpu_nodes() {
    local gpu_type="$1"
    # 只精确匹配最后一列的gpu_type
    local nodes=$(kubectl-resource-view node -t gpu --no-format | awk -v gt="$gpu_type" '$NF==gt && $2==0 && $4==0 {print $1}')
    echo "$nodes"
}

update_cronjob() {
    local namespace="$1"
    local cronjob_name="$2"
    local free_gpu_nodes="$3"
    local completions="$free_gpu_nodes"
    local parallelism="$free_gpu_nodes"

    echo "Updating CronJob: $cronjob_name, Completions: $completions, Parallelism: $parallelism"
    kubectl patch cronjob "$cronjob_name" -n "$namespace" --type='json' -p='[{"op": "replace", "path": "/spec/jobTemplate/spec/completions", "value": '"$completions"'},{"op": "replace", "path": "/spec/jobTemplate/spec/parallelism", "value": '"$parallelism"'}]'
    echo "$(date '+%Y-%m-%d %H:%M:%S') CronJob updated: completions=$completions, parallelism=$parallelism for $cronjob_name"
}

gpu_types=("nvidia.com/gpu-l40s" "nvidia.com/gpu-h100-80gb-hbm3" "nvidia.com/gpu-h100" "nvidia.com/gpu-h800")
for gpu_type in "${gpu_types[@]}"; do
    nodes=$(get_free_gpu_nodes "$gpu_type")
    free_gpu_nodes=$(echo "$nodes" | grep -c .)
    echo "Checking GPU type: $gpu_type, Free nodes: $free_gpu_nodes"
    if [ "$free_gpu_nodes" -gt 0 ]; then
        # 只去掉前缀，保留所有型号后缀，确保唯一性
        short_type=$(echo "$gpu_type" | sed 's#nvidia.com/gpu-##')
        cronjob_name="ghx-cronjob-$short_type"
        update_cronjob "$NAMESPACE" "$cronjob_name" "$free_gpu_nodes"
    fi
done