# gpu-burn
Multi-GPU CUDA stress test
http://wili.cc/blog/gpu-burn.html

# Easy docker build and run

```
git clone https://github.com/wilicc/gpu-burn
cd gpu-burn
docker build -t gpu_burn .
docker run --rm --gpus all gpu_burn
```

# Binary packages

https://repology.org/project/gpu-burn/versions

# Building
To build GPU Burn (CUDA <13 and ≥13):

`make -j`

To remove artifacts built by GPU Burn:

`make clean`

GPU Burn builds with a default Compute Capability of 5.0. To target a specific
architecture (independent of CUDA version), pass `COMPUTE` (e.g., 90 for compute_90):

`make -j COMPUTE=<compute capability value>`

CFLAGS can be added when invoking make to add to the default
list of compiler flags:

`make CFLAGS=-Wall`

LDFLAGS can be added when invoking make to add to the default
list of linker flags:

`make LDFLAGS=-lmylib`

NVCCFLAGS can be added when invoking make to add to the default
list of nvcc flags:

`make NVCCFLAGS=-ccbin <path to host compiler>`

CUDAPATH can be added to point to a non standard install or
specific version of the cuda toolkit (default is 
/usr/local/cuda):

`make CUDAPATH=/usr/local/cuda-<version>`

CCPATH can be specified to point to a specific gcc (default is
/usr/bin):

`make CCPATH=/usr/local/bin`

CUDA_VERSION and IMAGE_DISTRO can be used to override the base
images used when building the Docker `image` target, while IMAGE_NAME
can be set to change the resulting image tag:

`make IMAGE_NAME=myregistry.private.com/gpu-burn CUDA_VERSION=12.0.1 IMAGE_DISTRO=ubuntu22.04 image`

## CUDA 13.0 support

GPU Burn supports CUDA 13.0. 本地构建无需特别参数，直接使用 `make -j` 即可。

- 可选：查看工具链支持的算力架构列表：

```
nvcc --list-gpu-arch

compute_75
compute_80
compute_86
compute_87
compute_88
compute_89
compute_90
compute_100
compute_110
compute_103
compute_120
compute_121
```

- 可选：针对特定架构（例如 `compute_90`）本地构建：

```
make -j COMPUTE=90
```

- Docker 镜像构建（这里的 `CUDA_VERSION` 仅用于选择基础镜像）：

```
make IMAGE_NAME=myregistry.private.com/gpu-burn CUDA_VERSION=13.0 IMAGE_DISTRO=ubuntu22.04 image
```

# Usage

    GPU Burn
    Usage: gpu_burn [OPTIONS] [TIME]
    
    -m X   Use X MB of memory
    -m N%  Use N% of the available GPU memory
    -d     Use doubles
    -tc    Try to use Tensor cores (if available)
    -l     List all GPUs in the system
    -i N   Execute only on GPU N
    -h     Show this help message
    
    Example:
    gpu_burn -d 3600