"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { CheckCircle, XCircle, Play, RefreshCw, AlertTriangle, FileText, Minus, Download } from "lucide-react"
import { GpuStatusTable } from "@/components/gpu-status-table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TroubleshootingPageProps {
  theme: "light" | "dark"
  language: "zh" | "en"
  t: any
}

// GPU基准值配置
const defaultGpuBenchmarks = {
  "RTX 3090": { p2p: 18, nccl: 7, bw: 20 },
  L40S: { p2p: 28, nccl: 9, bw: 20 },
  "RTX 4090": { p2p: 18, nccl: 7, bw: 20 },
  A100: { p2p: 420, nccl: 70, bw: 20 },
  A800: { p2p: 340, nccl: 55, bw: 20 },
  H100: { p2p: 700, nccl: 139, bw: 40 },
  H800: { p2p: 340, nccl: 65, bw: 47 },
  H20: { p2p: 700, nccl: 139, bw: 47 },
  H200: { p2p: 730, nccl: 145, bw: 54 },
}





// 检查项目配置
const checkItems = {
  zh: [
    { id: "bandwidthTest", label: "Bandwidth Test", description: "测试GPU内存带宽性能，评估数据传输效率" },
    {
      id: "p2pBandwidthLatencyTest",
      label: "p2pBandwidthLatencyTest",
      description: "测试GPU间点对点通信带宽和延迟，评估多GPU协作性能",
    },
    { id: "ncclTests", label: "NCCL Tests", description: "测试NVIDIA集合通信库性能，评估分布式训练通信效率" },
    { id: "dcgmDiag", label: "DCGM Diagnostics", description: "NVIDIA数据中心GPU管理器诊断，检查GPU硬件健康状态" },
    { id: "ibCheck", label: "IB Check", description: "InfiniBand网络连接检查，确保高速网络通信正常" },
  ],
  en: [
    {
      id: "bandwidthTest",
      label: "Bandwidth Test",
      description: "Test GPU memory bandwidth performance, evaluate data transfer efficiency",
    },
    {
      id: "p2pBandwidthLatencyTest",
      label: "p2pBandwidthLatencyTest",
      description:
        "Test GPU peer-to-peer communication bandwidth and latency, evaluate multi-GPU collaboration performance",
    },
    {
      id: "ncclTests",
      label: "NCCL Tests",
      description:
        "Test NVIDIA Collective Communications Library performance, evaluate distributed training communication efficiency",
    },
    {
      id: "dcgmDiag",
      label: "DCGM Diagnostics",
      description: "NVIDIA Data Center GPU Manager diagnostics, check GPU hardware health status",
    },
    {
      id: "ibCheck",
      label: "IB Check",
      description: "InfiniBand network connection check, ensure high-speed network communication is normal",
    },
  ],
}

// 模拟GPU节点状态数据
const mockGpuStatusData = [
  {
    nodeName: "gpu-node-001",
    gpuType: "H200",
    gpuRequested: 8,
    nodeStatus: "idle",
    timestamp: "2024-01-15T02:00:00Z",
  },
  {
    nodeName: "gpu-node-002",
    gpuType: "H200",
    gpuRequested: 8,
    nodeStatus: "idle",
    timestamp: "2024-01-15T02:00:00Z",
  },
  {
    nodeName: "gpu-node-003",
    gpuType: "H100",
    gpuRequested: 8,
    nodeStatus: "busy",
    timestamp: "2024-01-15T02:00:00Z",
  },
  {
    nodeName: "gpu-node-004",
    gpuType: "A100",
    gpuRequested: 8,
    nodeStatus: "idle",
    timestamp: "2024-01-15T02:00:00Z",
  },
  {
    nodeName: "gpu-node-005",
    gpuType: "H800",
    gpuRequested: 8,
    nodeStatus: "busy",
    timestamp: "2024-01-15T02:00:00Z",
  },
]

export default function TroubleshootingPage({ theme, language, t }: TroubleshootingPageProps) {
  // GPU节点资源状态相关状态
  const [gpuNodeStatus, setGpuNodeStatus] = useState<any[]>(() => {
    // 从localStorage读取GPU节点状态数据
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-node-status-data")
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  const [gpuStatusLoading, setGpuStatusLoading] = useState(false)

  // GPU节点状态搜索和分页状态
  const [gpuStatusSearchTerm, setGpuStatusSearchTerm] = useState("")
  const [gpuStatusCurrentPage, setGpuStatusCurrentPage] = useState(1)
  const [gpuStatusPageSize, setGpuStatusPageSize] = useState(10)

  // GPU节点状态刷新限制
  const [gpuStatusLastRefresh, setGpuStatusLastRefresh] = useState<number>(0)
  const [gpuStatusRefreshDisabled, setGpuStatusRefreshDisabled] = useState(false)
  const [gpuStatusCountdown, setGpuStatusCountdown] = useState<number>(0)

  // 节点选择相关状态
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedCheckItems, setSelectedCheckItems] = useState<string[]>([
    "bandwidthTest", 
    "p2pBandwidthLatencyTest", 
    "ncclTests", 
    "dcgmDiag", 
    "ibCheck"
  ])
  const [diagnosticRunning, setDiagnosticRunning] = useState(false)
  const [diagnosticResults, setDiagnosticResults] = useState<any[]>([])
  const [showResults, setShowResults] = useState(false)
  
  // 新增：Job管理和诊断结果管理状态
  const [dcgmLevel, setDcgmLevel] = useState<number>(2)
  const [jobs, setJobs] = useState<any[]>([])
  const [jobLoading, setJobLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedResults, setSelectedResults] = useState<string[]>([])
  const [selectedResult, setSelectedResult] = useState<any>(null)
  const [showDetail, setShowDetail] = useState(false)
  
  // 诊断结果管理相关状态
  const [resultSearchTerm, setResultSearchTerm] = useState("")
  const [resultsCurrentPage, setResultsCurrentPage] = useState(1)
  const [resultsPageSize, setResultsPageSize] = useState(10)
  const [resultsRefreshDisabled, setResultsRefreshDisabled] = useState(false)
  const [resultsCountdown, setResultsCountdown] = useState<number>(0)
  const [resultsLastRefresh, setResultsLastRefresh] = useState<number>(0)
  

  
  // 节点搜索相关状态
  const [nodeSearchTerm, setNodeSearchTerm] = useState("")
  
  // 节点分页相关状态
  const [nodeCurrentPage, setNodeCurrentPage] = useState(1)
  const [nodePageSize, setNodePageSize] = useState(12) // 每页显示12个节点，适合3列布局

  // 排序相关状态
  const [sortField, setSortField] = useState<string>("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  // ==================== 优化后的刷新管理 ====================
  
  // 统一的刷新状态管理
  const [refreshState, setRefreshState] = useState({
    lastRefresh: 0,
    isRefreshing: false,
    nextRefreshTime: 0
  })
  
  // 智能刷新间隔配置
  const [refreshIntervals] = useState({
    idle: 300000,      // 空闲状态：5分钟
    active: 60000,     // 活动状态：1分钟
    critical: 30000    // 关键状态：30秒
  })
  
  // 防抖和节流相关状态
  const debounceTimeoutRef = useRef<NodeJS.Timeout>()
  const throttleLastCallRef = useRef(0)

  // 使用useRef管理倒计时定时器
  const gpuStatusCountdownRef = useRef<number | null>(null)

  // gpuBenchmarks 用 useState
  const [gpuBenchmarks, setGpuBenchmarks] = useState(() => {
    if (typeof window !== "undefined" && (window as any).GPU_BENCHMARKS) {
      return (window as any).GPU_BENCHMARKS
    }
    return defaultGpuBenchmarks
  })
  
  // 监听 GPU_BENCHMARKS 变化
  useEffect(() => {
    let lastBenchmarks: any = null
    
    const checkGpuBenchmarks = () => {
      if (typeof window !== "undefined" && (window as any).GPU_BENCHMARKS) {
        const currentBenchmarks = (window as any).GPU_BENCHMARKS
        // 只在值真正变化时才输出日志
        if (JSON.stringify(currentBenchmarks) !== JSON.stringify(lastBenchmarks)) {
          console.log('✅ 从 ConfigMap 读取到 GPU_BENCHMARKS:', currentBenchmarks)
          lastBenchmarks = currentBenchmarks
        }
        setGpuBenchmarks(currentBenchmarks)
      } else if (lastBenchmarks !== null) {
        // 只在从有值变为无值时输出一次日志
        console.log('❌ GPU_BENCHMARKS 未加载，使用默认值')
        lastBenchmarks = null
      }
    }
    
    // 立即检查一次
    checkGpuBenchmarks()
    
    // 降低检查频率到每5秒一次
    const interval = setInterval(checkGpuBenchmarks, 5000)
    
    return () => clearInterval(interval)
  }, [])
  
  // 性能单元格组件 - 与node-details-table保持一致
  const PerformanceCell = ({
    value,
    gpuType,
    testType,
    theme,
    t,
  }: {
    value: string
    gpuType: string
    testType: "bw" | "p2p" | "nccl"
    theme: "light" | "dark"
    t: any
  }) => {
    // 解析数值（去除单位）
    const parseValue = (valueStr: string | null | undefined): number => {
      if (!valueStr || typeof valueStr !== 'string') {
        return 0
      }
      return Number.parseFloat(valueStr.replace(/[^\d.]/g, "")) || 0
    }

    const benchmark = gpuBenchmarks[gpuType as keyof typeof gpuBenchmarks]
    if (!benchmark) return <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{value}</span>

    // 处理N/A值
    if (!value || value === 'N/A' || value === 'Unknown') {
      return (
        <div className="flex items-center space-x-2">
          <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{value}</span>
          <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
            (基准值: {benchmark[testType]} GB/s)
          </span>
          <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            <Minus className="w-3 h-3 mr-1" />
            N/A
          </Badge>
        </div>
      )
    }

    const numericValue = parseValue(value)
    const benchmarkValue = benchmark[testType]
    const isPass = numericValue >= benchmarkValue

    return (
      <div className="flex items-center space-x-2">
        <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{value}</span>
        <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
          (基准值: {benchmarkValue} GB/s)
        </span>
        {isPass ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
      </div>
    )
  }

  // 计算完成时间：created_at + execution_time
  const calculateCompletionTime = (createdAt: string, executionTime: string): string => {
    if (!createdAt || !executionTime || executionTime === 'N/A') {
      return createdAt || 'N/A'
    }
    
    try {
      // 解析创建时间
      const startTime = new Date(createdAt)
      
      // 解析执行时长 (格式: "0:00:47.562983" 或 "47.562983")
      let executionSeconds = 0
      if (executionTime.includes(':')) {
        // 格式: "0:00:47.562983"
        const parts = executionTime.split(':')
        const hours = parseInt(parts[0]) || 0
        const minutes = parseInt(parts[1]) || 0
        const seconds = parseFloat(parts[2]) || 0
        executionSeconds = hours * 3600 + minutes * 60 + seconds
      } else {
        // 格式: "47.562983"
        executionSeconds = parseFloat(executionTime) || 0
      }
      
      // 计算完成时间
      const completionTime = new Date(startTime.getTime() + executionSeconds * 1000)
      return completionTime.toISOString()
    } catch (error) {
      console.error('计算完成时间失败:', error)
      return createdAt || 'N/A'
    }
  }

  // 节点状态判断函数 - 根据所有测试结果判断节点是否通过
  const getNodeStatus = (result: any): string => {
    if (!result) return 'Unknown'
    
    // 检查DCGM和IB状态
    const dcgmStatus = result.dcgmDiag
    const ibStatus = result.ibCheck
    
    // 如果DCGM或IB不是Pass，则整体未通过
    if (dcgmStatus !== 'Pass' && dcgmStatus !== 'Skipped' && dcgmStatus !== 'N/A') {
      return 'No Pass'
    }
    if (ibStatus !== 'Pass' && ibStatus !== 'Skipped' && ibStatus !== 'N/A') {
      return 'No Pass'
    }
    
    // 检查性能测试结果
    const gpuType = result.gpuType
    const benchmark = gpuBenchmarks[gpuType as keyof typeof gpuBenchmarks]
    
    if (!benchmark) return 'Unknown'
    
    // 检查带宽测试 - 只检查有数值的测试
    const bandwidthTest = result.bandwidthTest
    if (bandwidthTest && bandwidthTest !== 'N/A' && bandwidthTest !== 'Unknown') {
      const bandwidthValue = parseFloat(bandwidthTest.replace(' GB/s', ''))
      if (isNaN(bandwidthValue) || bandwidthValue < benchmark.bw) {
        return 'No Pass'
      }
    }
    
    // 检查P2P测试 - 只检查有数值的测试
    const p2pTest = result.p2pBandwidthLatencyTest
    if (p2pTest && p2pTest !== 'N/A' && p2pTest !== 'Unknown') {
      const p2pValue = parseFloat(p2pTest.replace(' GB/s', ''))
      if (isNaN(p2pValue) || p2pValue < benchmark.p2p) {
        return 'No Pass'
      }
    }
    
    // 检查NCCL测试 - 只检查有数值的测试
    const ncclTest = result.ncclTests
    if (ncclTest && ncclTest !== 'N/A' && ncclTest !== 'Unknown') {
      const ncclValue = parseFloat(ncclTest.replace(' GB/s', ''))
      if (isNaN(ncclValue) || ncclValue < benchmark.nccl) {
        return 'No Pass'
      }
    }
    
    // 所有检查的测试都通过
    return 'Pass'
  }
  
  // ==================== 优化后的刷新函数 ====================
  
  // 智能刷新间隔计算
  const getRefreshInterval = useCallback(() => {
    const hasRunningJobs = jobs.some(job => {
      const lowerStatus = job.status?.toLowerCase()
      return lowerStatus === 'pending' || lowerStatus === 'running' || lowerStatus === 'creating'
    })
    const hasCriticalJobs = jobs.some(job => 
      job.status?.toLowerCase() === 'pending' || job.status?.toLowerCase() === 'creating'
    )
    
    if (hasCriticalJobs) return refreshIntervals.critical
    if (hasRunningJobs) return refreshIntervals.active
    return refreshIntervals.idle
  }, [jobs, refreshIntervals])
  
  // 防抖刷新函数
  const debouncedRefresh = useCallback((refreshFunction: () => void, delay: number = 1000) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    
    debounceTimeoutRef.current = setTimeout(() => {
      refreshFunction()
    }, delay)
  }, [])
  
  // 节流刷新函数
  const throttledRefresh = useCallback((refreshFunction: () => void, limit: number = 1000) => {
    const now = Date.now()
    if (now - throttleLastCallRef.current >= limit) {
      refreshFunction()
      throttleLastCallRef.current = now
    }
  }, [])
  
  // 统一的刷新执行函数
  const executeRefresh = useCallback(async (refreshFunction: () => Promise<void>) => {
    if (refreshState.isRefreshing) return
    
    setRefreshState(prev => ({ ...prev, isRefreshing: true }))
    try {
      await refreshFunction()
      setRefreshState(prev => ({ 
        ...prev, 
        lastRefresh: Date.now(),
        isRefreshing: false 
      }))
    } catch (error) {
      setRefreshState(prev => ({ ...prev, isRefreshing: false }))
      console.warn('刷新执行失败:', error)
    }
  }, [refreshState.isRefreshing])
  
  // 调度下次刷新
  const scheduleRefresh = useCallback((delay: number) => {
    const nextTime = Date.now() + delay
    setRefreshState(prev => ({ ...prev, nextRefreshTime: nextTime }))
  }, [])
  
  // 检查是否应该刷新
  const shouldRefresh = useCallback(() => {
    const now = Date.now()
    const lastRefresh = refreshState.lastRefresh
    const interval = getRefreshInterval()
    
    // 检查是否在冷却期内
    if (now - lastRefresh < interval) return false
    
    // 检查是否有活动任务
    const hasActiveJobs = jobs.some(job => {
      const lowerStatus = job.status?.toLowerCase()
      return lowerStatus === 'pending' || lowerStatus === 'running' || lowerStatus === 'creating'
    })
    
    return hasActiveJobs
  }, [refreshState.lastRefresh, getRefreshInterval, jobs])
  
  // 获取下次刷新时间显示
  const getNextRefreshTimeDisplay = useCallback(() => {
    const remaining = refreshState.nextRefreshTime - Date.now()
    if (remaining <= 0) return '即将刷新'
    
    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)
    return `${minutes}分${seconds}秒后刷新`
  }, [refreshState.nextRefreshTime])
  
  // 获取当前刷新间隔显示
  const getCurrentRefreshIntervalDisplay = useCallback(() => {
    const interval = getRefreshInterval()
    if (interval === refreshIntervals.critical) return '关键状态 (30秒)'
    if (interval === refreshIntervals.active) return '活动状态 (1分钟)'
    return '空闲状态 (5分钟)'
  }, [getRefreshInterval, refreshIntervals])



  const [usedGpuTypes, setUsedGpuTypes] = useState<string[]>([])

  // 获取当前语言的检查项目
  const currentCheckItems = checkItems[language]

  // 计算统计概要（按节点空闲状态分类）
  const gpuStatusSummary = {
    totalNodes: gpuNodeStatus && Array.isArray(gpuNodeStatus) ? gpuNodeStatus.length : 0,
    idleNodes: gpuNodeStatus && Array.isArray(gpuNodeStatus) ? gpuNodeStatus.filter((node) => node && node.nodeStatus === "idle").length : 0,
    busyNodes: gpuNodeStatus && Array.isArray(gpuNodeStatus) ? gpuNodeStatus.filter((node) => node && node.nodeStatus === "busy").length : 0,
    lastUpdated: gpuNodeStatus && Array.isArray(gpuNodeStatus) && gpuNodeStatus.length > 0 ? gpuNodeStatus[0]?.timestamp : null,
  }
  
  // 获取空闲节点并应用搜索过滤
  const idleNodes = gpuNodeStatus && Array.isArray(gpuNodeStatus) ? gpuNodeStatus.filter((node) => node && node.nodeStatus === "idle") : []
  const filteredIdleNodes = idleNodes.filter((node) => 
    node && node.nodeName?.toLowerCase().includes(nodeSearchTerm.toLowerCase())
  )
  

  
  // 分页相关计算
  const totalNodePages = Math.ceil((filteredIdleNodes && Array.isArray(filteredIdleNodes) ? filteredIdleNodes.length : 0) / nodePageSize)
  const startNodeIndex = (nodeCurrentPage - 1) * nodePageSize
  const endNodeIndex = startNodeIndex + nodePageSize
  const paginatedIdleNodes = filteredIdleNodes && Array.isArray(filteredIdleNodes) ? filteredIdleNodes.slice(startNodeIndex, endNodeIndex) : []
  
  // 当搜索词改变时，重置到第一页
  useEffect(() => {
    setNodeCurrentPage(1)
  }, [nodeSearchTerm])

  // 处理排序
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("asc")
    }
  }

  // 处理GPU状态页面变化
  const handleGpuStatusPageChange = (page: number) => {
    setGpuStatusCurrentPage(page)
  }

  const handleGpuStatusPageSizeChange = (size: number) => {
    setGpuStatusPageSize(size)
    setGpuStatusCurrentPage(1)
  }

  // 处理GPU状态刷新 - 统一使用API_BASE_URL
  const API_BASE_URL = typeof window !== "undefined" && (window as any).NEXT_PUBLIC_API_URL ? (window as any).NEXT_PUBLIC_API_URL : "http://localhost:5000"
  
  // 自动刷新状态
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => {
    // 从localStorage读取自动刷新状态，默认为false
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-auto-refresh-enabled")
      return saved ? JSON.parse(saved) : false
    }
    return false
  })
  
  // 分离的状态变量
  const [gpuNodeAutoRefresh, setGpuNodeAutoRefresh] = useState(() => {
    // 从localStorage读取GPU节点自动刷新状态，默认为false
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-node-auto-refresh-enabled")
      return saved ? JSON.parse(saved) : false
    }
    return false
  })
  
  const [jobStatusSSEEnabled, setJobStatusSSEEnabled] = useState(() => {
    // 从localStorage读取Job状态SSE监听状态，默认为true（启用实时更新）
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-job-status-sse-enabled")
      return saved ? JSON.parse(saved) : true  // 默认启用SSE
    }
    return true  // 默认启用SSE
  })
  
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(() => {
    // 从localStorage读取最后刷新时间
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-last-refresh-time")
      return saved ? parseInt(saved) : 0
    }
    return 0
  })
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshAttempts, setRefreshAttempts] = useState<number>(() => {
    // 从localStorage读取刷新尝试次数
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-refresh-attempts")
      return saved ? parseInt(saved) : 0
    }
    return 0
  })
  const [nextRefreshTime, setNextRefreshTime] = useState<number>(() => {
    // 从localStorage读取下次刷新时间
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-next-refresh-time")
      return saved ? parseInt(saved) : 0
    }
    return 0
  })
  const [hasInitialized, setHasInitialized] = useState(() => {
    // 从localStorage读取初始化状态
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gpu-has-initialized")
      return saved ? JSON.parse(saved) : false
    }
    return false
  })
  
  // 状态持久化函数
  const persistState = (key: string, value: any) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(value))
    }
  }
  
  // 自动刷新状态变化时持久化
  useEffect(() => {
    persistState("gpu-auto-refresh-enabled", autoRefreshEnabled)
  }, [autoRefreshEnabled])
  
  // 最后刷新时间变化时持久化
  useEffect(() => {
    persistState("gpu-last-refresh-time", lastRefreshTime)
  }, [lastRefreshTime])
  
  // 刷新尝试次数变化时持久化
  useEffect(() => {
    persistState("gpu-refresh-attempts", refreshAttempts)
  }, [refreshAttempts])
  
  // 下次刷新时间变化时持久化
  useEffect(() => {
    persistState("gpu-next-refresh-time", nextRefreshTime)
  }, [nextRefreshTime])
  
  // 初始化状态变化时持久化
  useEffect(() => {
    persistState("gpu-has-initialized", hasInitialized)
  }, [hasInitialized])
  
  // GPU节点数据变化时持久化
  useEffect(() => {
    if (gpuNodeStatus.length > 0) {
      persistState("gpu-node-status-data", gpuNodeStatus)
      console.log(`GPU节点数据已保存到localStorage，共 ${gpuNodeStatus.length} 个节点`)
      
      // 同时更新usedGpuTypes，确保GPU性能基准值对照表高亮正确
      if (gpuNodeStatus && Array.isArray(gpuNodeStatus) && gpuNodeStatus.length > 0) {
        const types = [...new Set(gpuNodeStatus.filter((node) => node && node.nodeStatus === 'idle').map((node) => {
          // 标准化GPU类型名称，将 nvidia.com/gpu-h200 转换为 H200
          const gpuType = node.gpuType || ''
          if (gpuType && typeof gpuType === 'string' && gpuType.includes('nvidia.com/gpu-')) {
            return gpuType.replace('nvidia.com/gpu-', '').toUpperCase()
          }
          return gpuType
        }))]
        setUsedGpuTypes(types)
        console.log(`已设置使用的GPU类型: ${types.join(', ')}`)
      } else {
        setUsedGpuTypes([])
        console.log('GPU节点数据为空或无效，清空使用的GPU类型')
      }
    }
  }, [gpuNodeStatus])
  
  const handleRefreshGpuStatus = async (forceRefresh = false) => {
    const now = Date.now()
    const timeSinceLastRefresh = now - gpuStatusLastRefresh
    const cooldownPeriod = 20000 // 20秒冷却时间，配合后端1分钟3次的限制

    // 检查是否在冷却期内
    if (!forceRefresh && timeSinceLastRefresh < cooldownPeriod) {
      const remainingTime = Math.ceil((cooldownPeriod - timeSinceLastRefresh) / 1000)
      setRefreshError(`请等待 ${remainingTime} 秒后再试（API限制：1分钟3次）`)
      return
    }

    setGpuStatusLoading(true)
    setGpuStatusLastRefresh(now)
    setGpuStatusRefreshDisabled(true)
    setRefreshError(null)
    setRefreshAttempts(prev => prev + 1)

    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/node-status`)
      
      if (response.status === 429) {
        // 处理429错误 - 计算下次可刷新时间
        const retryAfter = response.headers.get('Retry-After')
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : cooldownPeriod
        const nextRefresh = now + waitTime
        
        setNextRefreshTime(nextRefresh)
        setRefreshError(`API请求过于频繁，请等待 ${Math.ceil(waitTime / 1000)} 秒后再试`)
        
        // 自动设置倒计时
        let countdown = Math.ceil(waitTime / 1000)
        setGpuStatusCountdown(countdown)
        
        gpuStatusCountdownRef.current = window.setInterval(() => {
          countdown -= 1
          setGpuStatusCountdown(countdown)
          
          if (countdown <= 0) {
            setGpuStatusRefreshDisabled(false)
            setNextRefreshTime(0)
            if (gpuStatusCountdownRef.current) {
              clearInterval(gpuStatusCountdownRef.current)
              gpuStatusCountdownRef.current = null
            }
          }
        }, 1000)
        
        return
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const result = await response.json()
      if (result.error) {
        throw new Error(result.message || '获取GPU节点状态失败')
      }
      
      const nodes = result.nodes || []
      setGpuNodeStatus(nodes)
      setLastRefreshTime(now)
      setNextRefreshTime(0)
      setRefreshAttempts(0)
      
      // 提取使用的GPU类型（从空闲节点中提取）
      if (nodes && Array.isArray(nodes) && nodes.length > 0) {
        const types = [...new Set(nodes.filter((node: any) => node && node.nodeStatus === 'idle').map((node: any) => node.gpuType || ''))]
      setUsedGpuTypes(types)
      } else {
        setUsedGpuTypes([])
      }
      
      // 显示成功提示
      console.log(`成功获取 ${nodes.length} 个GPU节点状态`)
      
      // 成功后的倒计时 - 改为20秒，配合新的频率限制
      let countdown = 20
      setGpuStatusCountdown(countdown)
      gpuStatusCountdownRef.current = window.setInterval(() => {
        countdown -= 1
        setGpuStatusCountdown(countdown)
        if (countdown <= 0) {
          setGpuStatusRefreshDisabled(false)
          if (gpuStatusCountdownRef.current) {
            clearInterval(gpuStatusCountdownRef.current)
            gpuStatusCountdownRef.current = null
          }
        }
      }, 1000)
      
    } catch (err: any) {
      const errorMessage = err.message || '获取GPU节点状态失败'
      setRefreshError(errorMessage)
      console.error('GPU状态刷新失败:', errorMessage)
      
      // 只有在没有数据时才使用mock数据
      if (gpuNodeStatus.length === 0) {
        console.warn('使用mock数据作为fallback')
        if (mockGpuStatusData && Array.isArray(mockGpuStatusData) && mockGpuStatusData.length > 0) {
          const types = [...new Set(mockGpuStatusData.filter((node) => node && node.nodeStatus === 'idle').map((node) => {
            const gpuType = node.gpuType || ''
            if (gpuType && typeof gpuType === 'string' && gpuType.includes('nvidia.com/gpu-')) {
              return gpuType.replace('nvidia.com/gpu-', '').toUpperCase()
            }
            return gpuType
          }))]
      setUsedGpuTypes(types)
        } else {
          setUsedGpuTypes([])
        }
      }
      
      // 设置倒计时
      let countdown = 60
      setGpuStatusCountdown(countdown)
      gpuStatusCountdownRef.current = window.setInterval(() => {
        countdown -= 1
        setGpuStatusCountdown(countdown)
        if (countdown <= 0) {
          setGpuStatusRefreshDisabled(false)
          if (gpuStatusCountdownRef.current) {
            clearInterval(gpuStatusCountdownRef.current)
            gpuStatusCountdownRef.current = null
          }
        }
      }, 1000)
    } finally {
      setGpuStatusLoading(false)
    }
  }
  
  // 智能刷新 - 检查是否可以刷新
  const handleSmartRefresh = () => {
    const now = Date.now()
    const timeSinceLastRefresh = now - gpuStatusLastRefresh
    const cooldownPeriod = 20000 // 改为20秒，配合后端1分钟3次的限制
    
    if (timeSinceLastRefresh >= cooldownPeriod) {
      // 可以刷新
      handleRefreshGpuStatus(false)
    } else {
      // 显示剩余时间
      const remainingTime = Math.ceil((cooldownPeriod - timeSinceLastRefresh) / 1000)
      setRefreshError(`请等待 ${remainingTime} 秒后再试（API限制：1分钟3次）`)
    }
  }
  
  // 实时Job状态监听 - 使用SSE替代频繁刷新
  useEffect(() => {
    if (!jobStatusSSEEnabled) return
    
    let eventSource: EventSource | null = null
    
    try {
      console.log('🚀 开始建立SSE连接...')
      console.log('📡 API地址:', `${API_BASE_URL}/api/gpu-inspection/job-status-stream`)
      console.log('🌐 网络状态:', navigator.onLine ? '在线' : '离线')
      
      // 建立SSE连接
      eventSource = new EventSource(`${API_BASE_URL}/api/gpu-inspection/job-status-stream`)
      
      eventSource.onopen = () => {
        console.log('✅ SSE连接已建立')
        console.log('🔗 连接状态:', eventSource.readyState)
        console.log('📊 当前时间:', new Date().toLocaleTimeString())
      }
      
      eventSource.onmessage = (event) => {
        try {
          console.log('收到SSE消息:', event.data)
          const data = JSON.parse(event.data)
          
          switch (data.type) {
            case 'connected':
              console.log('✅ SSE连接成功:', data.message)
              break
              
            case 'job_status_change':
              console.log('🔄 收到Job状态变化:', data)
              console.log('📋 当前Jobs状态:', jobs.map(j => ({ id: j.jobId, status: j.status })))
              
              // 立即更新本地Job状态，无需刷新整个列表
              setJobs(prevJobs => {
                const updatedJobs = prevJobs.map(job => 
                  job.jobId === data.job_id 
                    ? { ...job, status: data.status }
                    : job
                )
                const updatedJob = updatedJobs.find(j => j.jobId === data.job_id)
                console.log('✅ Job状态已更新:', updatedJob)
                console.log('📊 更新后所有Jobs:', updatedJobs.map(j => ({ id: j.jobId, status: j.status })))
                return updatedJobs
              })
              
              // 如果Job完成，自动刷新诊断结果
              if (data.status === 'Completed' || data.status === 'Succeeded' || data.status === 'Failed') {
                console.log('Job已完成，准备刷新诊断结果...')
                setTimeout(() => {
                  refreshDiagnosticResults()
                }, 2000) // 延迟2秒，等待后端处理完成
              }
              break
              
            case 'heartbeat':
              // 心跳消息，保持连接活跃
              console.log('💓 SSE心跳:', new Date().toLocaleTimeString())
              break
              
            case 'diagnostic_results_updated':
              console.log('📊 收到诊断结果更新通知:', data.message)
              // 立即刷新诊断结果
              setTimeout(() => {
                refreshDiagnosticResults()
              }, 1000) // 延迟1秒，确保后端处理完成
              break
              
            default:
              console.log('❓ 未知的SSE消息类型:', data.type)
          }
        } catch (error) {
          console.warn('⚠️ 解析SSE消息失败:', error)
        }
      }
      
      eventSource.onerror = (error) => {
        console.error('❌ SSE连接错误:', error)
        console.log('🔍 连接状态:', eventSource.readyState)
        console.log('🌐 网络状态:', navigator.onLine ? '在线' : '离线')
        
        // 尝试重连
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('🔄 SSE连接已关闭，尝试重连...')
          setTimeout(() => {
            if (jobStatusSSEEnabled) {
              console.log('🔄 重新建立SSE连接...')
              // 这里会触发useEffect重新执行
            }
          }, 3000) // 3秒后重连
        } else {
          // 连接错误时，回退到手动刷新模式
          setJobStatusSSEEnabled(false)
        }
      }
      
    } catch (error) {
      console.error('❌ 建立SSE连接失败:', error)
      // 回退到手动刷新模式
      setJobStatusSSEEnabled(false)
    }
    
    return () => {
      if (eventSource) {
        eventSource.close()
        console.log('🔌 SSE连接已关闭')
      }
    }
  }, [jobStatusSSEEnabled, API_BASE_URL]) // 使用jobStatusSSEEnabled状态

  // 简化的诊断任务状态刷新 - 主要依赖SSE，这里只做兜底
  useEffect(() => {
    // 只在有活动任务且SSE不可用时才刷新
    const hasActiveJobs = jobs.some(job => 
      job.status === 'pending' || job.status === 'running'
    )
    
    if (hasActiveJobs && !autoRefreshEnabled) {
      // 如果SSE不可用，使用定时刷新作为兜底
      const interval = setInterval(async () => {
        try {
          await fetchJobs()
        } catch (error) {
          console.warn('兜底刷新失败:', error)
        }
      }, 60000) // 1分钟刷新一次作为兜底
      
      return () => clearInterval(interval)
    }
  }, [jobs, autoRefreshEnabled])

  // 处理节点选择
  const handleNodeSelection = (nodeId: string, checked: boolean) => {
    if (checked) {
      setSelectedNodes([...selectedNodes, nodeId])
    } else {
      setSelectedNodes(selectedNodes.filter((id) => id !== nodeId))
    }
  }

  // 处理检查项目选择
  const handleCheckItemSelection = (itemId: string, checked: boolean) => {
    if (checked) {
      setSelectedCheckItems([...selectedCheckItems, itemId])
    } else {
      setSelectedCheckItems(selectedCheckItems.filter((id) => id !== itemId))
    }
  }

  // 开始诊断
  const handleStartDiagnostic = () => {
    if (selectedNodes.length === 0 || selectedCheckItems.length === 0) {
      return
    }

    setDiagnosticRunning(true)
    setShowResults(false)

      // 生成模拟诊断结果
      const results = selectedNodes.map((nodeId) => {
      const node = gpuNodeStatus && Array.isArray(gpuNodeStatus) ? gpuNodeStatus.find((n) => n && n.nodeName === nodeId) : null
        return {
          hostname: nodeId,
          gpuType: node?.gpuType || "Unknown",
          bandwidthTest: selectedCheckItems.includes("bandwidthTest") ? "54.9 GB/s" : "N/A",
          p2pBandwidthLatencyTest: selectedCheckItems.includes("p2pBandwidthLatencyTest") ? "736.40 GB/s" : "N/A",
          ncclTests: selectedCheckItems.includes("ncclTests") ? "150.946 GB/s" : "N/A",
          dcgmDiag: selectedCheckItems.includes("dcgmDiag") ? "Pass" : "N/A",
          ibCheck: selectedCheckItems.includes("ibCheck") ? "Pass" : "N/A",
          executionLog: `诊断开始时间: ${new Date().toLocaleString()}\n执行的检查项目: ${selectedCheckItems.join(", ")}\n诊断完成，所有项目通过`,
          executionTime: new Date().toISOString(),
        }
      })

      setDiagnosticResults(results)
      setDiagnosticRunning(false)
      setShowResults(true)
  }

  // 新增：Job管理相关函数
  const createJob = async (selectedNodes: string[], enabledTests: string[], dcgmLevel: number) => {
    try {
      // 添加详细的调试日志
      console.log('createJob函数调用参数:', {
        selectedNodes,
        enabledTests,
        dcgmLevel
      })
      
      const requestBody = {
        selectedNodes,
        enabledTests,
        ...(enabledTests.includes('dcgmDiag') && { dcgmLevel })
      }
      
      console.log('发送到后端的请求体:', JSON.stringify(requestBody, null, 2))
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/create-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })
      
      console.log('后端响应状态:', response.status, response.statusText)
      
      const result = await response.json()
      console.log('后端返回结果:', result)
      
      if (result.success) {
        return result
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('创建Job异常:', error)
      throw error
    }
  }

  const stopJob = async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/stop-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId })
      })
      
      const result = await response.json()
      if (result.success) {
        return result
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('停止Job异常:', error)
      throw error
    }
  }

  // 获取Job的实时状态（通过gpu-cli服务）
  const getJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/job-status/${jobId}`)
      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          return result
        }
      }
      return null
    } catch (error) {
      console.warn(`获取Job ${jobId} 状态失败:`, error)
      return null
    }
  }

  const getJobList = async () => {
    if (refreshing) return
    
    setRefreshing(true)
    try {
      console.log('开始获取Job列表...')
      console.log('API URL:', `${API_BASE_URL}/api/gpu-inspection/list-jobs`)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/list-jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 添加超时设置
        signal: AbortSignal.timeout(30000) // 30秒超时
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('获取Job列表成功:', data.jobs)
        
        // 处理Job状态
        const processedJobs = await Promise.all(
          data.jobs.map(async (job: any) => {
            try {
              // 获取Job的实时状态
              const statusResponse = await fetch(`${API_BASE_URL}/api/gpu-inspection/job-status/${job.jobId}`, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(10000) // 10秒超时
              })
              
              if (statusResponse.ok) {
                const statusData = await statusResponse.json()
                if (statusData.success) {
                  return {
                    ...job,
                    status: statusData.status || job.status,
                    podStatus: statusData.podStatus,
                    lastStatusUpdate: statusData.timestamp
                  }
                }
              }
              
              return job
            } catch (error) {
              console.warn(`获取Job ${job.jobId} 状态失败:`, error)
              return job
            }
          })
        )
        
        setJobs(processedJobs)
        
        // 保存到localStorage
        try {
          localStorage.setItem('diagnostic-jobs-data', JSON.stringify(processedJobs))
        } catch (e) {
          console.warn('保存Job数据到localStorage失败:', e)
        }
        
        // 统计状态
        const statusCounts = processedJobs.reduce((acc: any, job: any) => {
          acc[job.status] = (acc[job.status] || 0) + 1
          return acc
        }, {})
        
        console.log('Job状态统计:', statusCounts)
        
      } else {
        console.error('获取Job列表失败:', data.error)
        // 尝试从localStorage恢复数据
        try {
          const savedJobs = localStorage.getItem('diagnostic-jobs-data')
          if (savedJobs) {
            const parsedJobs = JSON.parse(savedJobs)
            setJobs(parsedJobs)
            console.log('从localStorage恢复Job数据:', parsedJobs.length, '条')
          }
        } catch (e) {
          console.warn('从localStorage恢复Job数据失败:', e)
        }
      }
    } catch (error) {
      console.error('获取Job列表异常:', error)
      
      // 如果是网络错误，尝试从localStorage恢复数据
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        try {
          const savedJobs = localStorage.getItem('diagnostic-jobs-data')
          if (savedJobs) {
            const parsedJobs = JSON.parse(savedJobs)
            setJobs(parsedJobs)
            console.log('网络错误，从localStorage恢复Job数据:', parsedJobs.length, '条')
          }
        } catch (e) {
          console.warn('从localStorage恢复Job数据失败:', e)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  const getDiagnosticResults = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/results`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (result.success && result.results) {
        return Array.isArray(result.results) ? result.results : []
      } else {
        console.warn('获取诊断结果响应格式不正确:', result)
        return []
      }
    } catch (error) {
      console.error('获取诊断结果异常:', error)
      return [] // 返回空数组而不是抛出错误
    }
  }

  const getDiagnosticResultDetail = async (jobId: string) => {
    try {
      if (!jobId) {
        console.error('Job ID无效:', jobId)
        return null
      }
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/results/job/${jobId}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (result.success && result.result) {
        return result.result
      } else {
        console.warn('获取诊断结果详情响应格式不正确:', result)
        return null
      }
    } catch (error) {
      console.error('获取诊断结果详情异常:', error)
      return null // 返回null而不是抛出错误
    }
  }

  // 导出选中的诊断结果
  const exportSelectedResults = async () => {
    try {
      if (selectedResults.length === 0) {
        console.error(t.pleaseSelectDiagnosticResults)
        return
      }

      // 动态导入JSZip
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      // 获取选中的诊断结果
      const selectedDiagnosticResults = diagnosticResults.filter(result => 
        selectedResults.includes(result.jobId)
      )

      // 为每个选中的诊断结果创建日志文件
      selectedDiagnosticResults.forEach((result, index) => {
        // 获取完整的执行日志，包括所有可能的日志字段
        // 优先使用originalResult中的数据，因为那里可能包含更完整的信息
        const originalResult = result.originalResult || result
        const executionLog = originalResult.executionLog || result.executionLog || originalResult.execution_log || result.execution_log || originalResult.log || result.log || t.noLog
        const benchmarkData = originalResult.benchmarkData || result.benchmarkData || originalResult.benchmark_data || result.benchmark_data || originalResult.benchmark || result.benchmark || {}
        const testResults = originalResult.testResults || result.testResults || originalResult.test_results || result.test_results || {}
        
        const exportContent = `=== GPU诊断结果执行日志 ===
主机名称: ${result.nodeName || result.hostname || 'N/A'}
GPU类型: ${result.gpuType || 'N/A'}
Job ID: ${result.jobId || 'N/A'}
DCGM诊断级别: ${result.enabledTests && result.enabledTests.includes('dcgmDiag') ? (result.dcgmLevel || 'N/A') : 'N/A'}
完成时间: ${calculateCompletionTime(result.createdAt, result.executionTime) || 'N/A'}
整体结果: ${result.inspectionResult || 'N/A'}
性能测试: ${result.performancePass ? t.pass : t.noPass}
健康检查: ${result.healthPass ? t.pass : t.noPass}

=== 基准测试数据 ===
${JSON.stringify(benchmarkData, null, 2)}

=== 测试结果 ===
${JSON.stringify(testResults, null, 2)}

=== 执行日志详情 ===
${executionLog}

=== 导出信息 ===
导出时间: ${new Date().toLocaleString('zh-CN')}
导出来源: GPU诊断系统`

        // 添加到ZIP文件中
        const fileName = `diagnostic_result_${result.nodeName || result.jobId || `result_${index + 1}`}_${new Date().toISOString().split('T')[0]}.log`
        zip.file(fileName, exportContent)
      })

      // 生成ZIP文件
      const zipBlob = await zip.generateAsync({ type: 'blob' })

      // 创建下载链接
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagnostic_results_${selectedResults.length}_items_${new Date().toISOString().split('T')[0]}.zip`
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // 清理URL对象
      URL.revokeObjectURL(url)
      
      console.log(`批量导出成功，共导出 ${selectedResults.length} 个诊断结果`)
    } catch (error) {
      console.error('批量导出诊断结果失败:', error)
      alert('批量导出诊断结果失败: ' + (error as Error).message)
    }
  }

  // 删除选中的诊断结果
  const deleteSelectedResults = async () => {
    if (selectedResults.length === 0) {
      console.error(t.pleaseSelectDiagnosticResults)
      return
    }
    
    try {
      console.log(t.startBatchDelete + ':', selectedResults)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/delete-diagnostic-results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resultIds: selectedResults })
      })
      
      const result = await response.json()
      if (result.success) {
        console.log(t.batchDeleteSuccess + ':', result.message)
        
        // 立即从本地状态中移除已删除的诊断结果
        setDiagnosticResults(prevResults => prevResults.filter(result => !selectedResults.includes(result.jobId)))
        setSelectedResults([])
        
        // 显示成功消息
        alert(`${t.batchDeleteSuccess}: ${result.message}`)
        
        // 自动刷新诊断结果列表，确保数据同步
        setTimeout(() => {
          refreshDiagnosticResults()
        }, 500)
      } else {
        throw new Error(result.error || t.batchDeleteFailed)
      }
    } catch (error) {
      console.error(t.batchDeleteFailed + ':', error)
      alert(`${t.batchDeleteFailed}: ${error.message}`)
    }
  }

  // 删除单个诊断结果
  const deleteDiagnosticResult = async (resultId: string) => {
    try {
      console.log(t.startDelete + ':', resultId)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/delete-diagnostic-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resultId })
      })
      
      const result = await response.json()
      if (result.success) {
        console.log(t.diagnosticResultDeleteSuccess + ':', result.message)
        
        // 立即从本地状态中移除已删除的诊断结果
        setDiagnosticResults(prevResults => prevResults.filter(result => result.jobId !== resultId))
        setSelectedResults(prev => prev.filter(id => id !== resultId))
        
        // 显示成功消息
        alert(`${t.diagnosticResultDeleteSuccess}: ${result.message}`)
        
        // 自动刷新诊断结果列表，确保数据同步
        setTimeout(() => {
          refreshDiagnosticResults()
        }, 500)
      } else {
        throw new Error(result.error || t.diagnosticResultDeleteFailed)
      }
    } catch (error) {
      console.error(t.diagnosticResultDeleteFailed + ':', error)
      alert(`${t.diagnosticResultDeleteFailed}: ${error.message}`)
    }
  }

  // 获取Job列表
  const fetchJobs = async () => {
    if (refreshing) return
    
    setRefreshing(true)
    try {
      console.log('开始获取Job列表...')
      console.log('API URL:', `${API_BASE_URL}/api/gpu-inspection/list-jobs`)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/list-jobs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 添加超时设置
        signal: AbortSignal.timeout(30000) // 30秒超时
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('获取Job列表成功:', data.jobs)
        
        // 处理Job状态
        const processedJobs = await Promise.all(
          data.jobs.map(async (job: any) => {
            try {
              // 获取Job的实时状态
              const statusResponse = await fetch(`${API_BASE_URL}/api/gpu-inspection/job-status/${job.jobId}`, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(10000) // 10秒超时
              })
              
              if (statusResponse.ok) {
                const statusData = await statusResponse.json()
                if (statusData.success) {
                  return {
                    ...job,
                    status: statusData.status || job.status,
                    podStatus: statusData.podStatus,
                    lastStatusUpdate: statusData.timestamp
                  }
                }
              }
              
              return job
            } catch (error) {
              console.warn(`获取Job ${job.jobId} 状态失败:`, error)
              return job
            }
          })
        )
        
        setJobs(processedJobs)
        
        // 保存到localStorage
        try {
          localStorage.setItem('diagnostic-jobs-data', JSON.stringify(processedJobs))
        } catch (e) {
          console.warn('保存Job数据到localStorage失败:', e)
        }
        
        // 统计状态
        const statusCounts = processedJobs.reduce((acc: any, job: any) => {
          acc[job.status] = (acc[job.status] || 0) + 1
          return acc
        }, {})
        
        console.log('Job状态统计:', statusCounts)
        
      } else {
        console.error('获取Job列表失败:', data.error)
        // 尝试从localStorage恢复数据
        try {
          const savedJobs = localStorage.getItem('diagnostic-jobs-data')
          if (savedJobs) {
            const parsedJobs = JSON.parse(savedJobs)
            setJobs(parsedJobs)
            console.log('从localStorage恢复Job数据:', parsedJobs.length, '条')
          }
        } catch (e) {
          console.warn('从localStorage恢复Job数据失败:', e)
        }
      }
    } catch (error) {
      console.error('获取Job列表异常:', error)
      
      // 如果是网络错误，尝试从localStorage恢复数据
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        try {
          const savedJobs = localStorage.getItem('diagnostic-jobs-data')
          if (savedJobs) {
            const parsedJobs = JSON.parse(savedJobs)
            setJobs(parsedJobs)
            console.log('网络错误，从localStorage恢复Job数据:', parsedJobs.length, '条')
          }
        } catch (e) {
          console.warn('从localStorage恢复Job数据失败:', e)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  // 开始诊断
  const handleCreateJob = async () => {
    if (selectedNodes.length === 0) {
      console.error('请选择至少一个节点')
      return
    }
    
    if (selectedCheckItems.length === 0) {
      console.error('请选择至少一个检查项目')
      return
    }
    
    // 添加调试日志
    console.log('创建诊断任务参数:', {
      selectedNodes,
      selectedCheckItems,
      dcgmLevel
    })
    
    try {
      setJobLoading(true)
      const result = await createJob(selectedNodes, selectedCheckItems, dcgmLevel)
      console.log('诊断任务创建成功:', result.jobId)
      
      // 刷新任务列表
      await fetchJobs()
      
      // 等待一段时间后获取诊断结果（给Job执行时间）
      setTimeout(async () => {
        try {
          console.log('等待Job执行完成后获取诊断结果...')
          const diagnosticResults = await getDiagnosticResults()
          if (diagnosticResults && Array.isArray(diagnosticResults) && diagnosticResults.length > 0) {
            setDiagnosticResults(diagnosticResults)
            setShowResults(true)
            console.log('成功获取诊断结果:', diagnosticResults.length, '条记录')
          } else {
            console.log('暂无诊断结果，可能Job还在执行中...')
            // 设置一个标志，让用户知道需要等待
            setShowResults(false)
          }
        } catch (error) {
          console.log('获取诊断结果失败:', error)
          // 即使失败也显示结果区域，让用户可以手动刷新
          setShowResults(true)
        }
      }, 5000) // 等待5秒
      
    } catch (error: any) {
      console.error('诊断任务创建失败:', error.message)
    } finally {
      setJobLoading(false)
    }
  }

  // 停止Job
  const handleStopJob = async (jobId: string) => {
    try {
      await stopJob(jobId)
      console.log('Job停止成功:', jobId)
      await fetchJobs()
    } catch (error: any) {
      console.error('Job停止失败:', error.message)
    }
  }

  // 查看详情
  const viewResult = async (result: any) => {
    try {
      if (!result || !result.jobId) {
        console.error('无效的结果对象:', result)
        alert('无效的诊断结果')
        return
      }
      
      console.log('开始获取诊断结果详情:', result.jobId)
      console.log('API URL:', `${API_BASE_URL}/api/gpu-inspection/results/${result.jobId}`)
      
      const detail = await getDiagnosticResultDetail(result.jobId)
      
      if (detail) {
        setSelectedResult(detail)
        setShowDetail(true)
      } else {
        console.error('获取详情失败: 返回数据为空')
        alert('获取诊断结果详情失败: 数据为空')
      }
    } catch (error: any) {
      console.error('获取详情失败:', error)
      // 显示错误信息给用户
      alert(`获取诊断结果详情失败: ${error.message || '未知错误'}`)
    }
  }

  // 导出诊断日志 - 与节点检查详情保持一致
  const handleExportDiagnosticLog = (result: any) => {
    try {
      if (!result) {
        console.error('无效的结果对象')
        return
      }

      // 获取完整的执行日志，包括所有可能的日志字段
      // 优先使用originalResult中的数据，因为那里可能包含更完整的信息
      const originalResult = result.originalResult || result
      const executionLog = originalResult.executionLog || result.executionLog || originalResult.execution_log || result.execution_log || originalResult.log || result.log || t.noLog
      const benchmarkData = originalResult.benchmarkData || result.benchmarkData || originalResult.benchmark_data || result.benchmark_data || originalResult.benchmark || result.benchmark || {}
      const testResults = originalResult.testResults || result.testResults || originalResult.test_results || result.test_results || {}
      
      // 准备导出内容 - 使用纯文本格式，提升可读性
      const exportContent = `=== GPU诊断结果执行日志 ===
主机名称: ${result.nodeName || result.hostname || 'N/A'}
GPU类型: ${result.gpuType || 'N/A'}
Job ID: ${result.jobId || 'N/A'}
DCGM诊断级别: ${result.enabledTests && result.enabledTests.includes('dcgmDiag') ? (result.dcgmLevel || 'N/A') : 'N/A'}
完成时间: ${calculateCompletionTime(result.createdAt, result.executionTime) || 'N/A'}
整体结果: ${result.inspectionResult || 'N/A'}
性能测试: ${result.performancePass ? t.pass : t.noPass}
健康检查: ${result.healthPass ? t.pass : t.noPass}

=== 基准测试数据 ===
${JSON.stringify(benchmarkData, null, 2)}

=== 测试结果 ===
${JSON.stringify(testResults, null, 2)}

=== 执行日志详情 ===
${executionLog}

=== 导出信息 ===
导出时间: ${new Date().toLocaleString('zh-CN')}
导出来源: GPU诊断系统`

      // 创建Blob对象
      const blob = new Blob([exportContent], {
        type: 'text/plain;charset=utf-8'
      })

      // 创建下载链接
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagnostic_result_${result.nodeName || result.jobId}_${new Date().toISOString().split('T')[0]}.log`
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // 清理URL对象
      URL.revokeObjectURL(url)
      
      console.log('诊断日志导出成功')
    } catch (error) {
      console.error('导出诊断日志失败:', error)
      alert('导出诊断日志失败')
    }
  }

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedResults.length === diagnosticResults.length) {
      setSelectedResults([])
    } else {
      setSelectedResults(diagnosticResults.map(r => r.jobId))
    }
  }

  // 全选/取消全选Jobs
  const toggleSelectAllJobs = () => {
    if (selectedJobs.length === jobs.length) {
      setSelectedJobs([])
    } else {
      setSelectedJobs(jobs.map(job => job.jobId))
    }
  }

  // 简化的Job状态检查 - 主要依赖SSE，这里只做兜底
  useEffect(() => {
    if (jobs.length === 0) return
    
    // 只在SSE不可用时才做定时检查
    if (!autoRefreshEnabled) {
      const hasRunningJob = jobs.some(job => 
        job.status === 'Running' || 
        job.status === 'Creating' || 
        job.status === 'Pending' ||
        job.status.includes('Waiting:')
      )
      
      if (hasRunningJob) {
        // 兜底检查，每2分钟检查一次
        const interval = setInterval(async () => {
          try {
            await fetchJobs()
          } catch (error) {
            console.warn('兜底Job状态检查失败:', error)
          }
        }, 120000) // 2分钟检查一次
        
        return () => clearInterval(interval)
      }
    }
  }, [jobs, autoRefreshEnabled])

  // 删除选中的Jobs
  const deleteSelectedJobs = async () => {
    if (selectedJobs.length === 0) {
      console.error(t.pleaseSelectJobs)
      return
    }
    
    try {
      console.log(t.startBatchDelete + ':', selectedJobs)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/delete-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobIds: selectedJobs })
      })
      
      const result = await response.json()
      if (result.success) {
        console.log(t.batchDeleteSuccess + ':', result.message)
        
        // 立即从本地状态中移除已删除的Jobs
        setJobs(prevJobs => prevJobs.filter(job => !selectedJobs.includes(job.jobId)))
        setSelectedJobs([])
        
        // 同时刷新诊断结果，移除被删除任务的相关结果
        setDiagnosticResults(prevResults => 
          prevResults.filter(result => !selectedJobs.includes(result.jobId))
        )
        
        // 使用防抖刷新，避免触发限流
        debouncedRefresh(async () => {
          try {
            await executeRefresh(fetchJobs)
            await executeRefresh(refreshDiagnosticResults)
          } catch (error) {
            console.warn(t.delayedRefreshFailed + ':', error)
          }
        }, 3000) // 3秒后刷新
        
        // 显示成功消息
        alert(`${t.batchDeleteSuccess}: ${result.message}`)
      } else {
        throw new Error(result.error || t.batchDeleteFailed)
      }
    } catch (error) {
      console.error(t.batchDeleteFailed + ':', error)
      alert(`${t.batchDeleteFailed}: ${error.message}`)
    }
  }

  // 删除单个Job
  const deleteJob = async (jobId: string) => {
    try {
      console.log(t.startDelete + ':', jobId)
      
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/delete-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId })
      })
      
      const result = await response.json()
      if (result.success) {
        console.log(t.deleteSuccess + ':', result.message)
        
        // 立即从本地状态中移除已删除的Job
        setJobs(prevJobs => prevJobs.filter(job => job.jobId !== jobId))
        setSelectedJobs(prev => prev.filter(id => id !== jobId))
        
        // 同时刷新诊断结果，移除被删除任务的相关结果
        setDiagnosticResults(prevResults => 
          prevResults.filter(result => result.jobId !== jobId)
        )
        
        // 延迟刷新Job列表和诊断结果，避免速率限制
        setTimeout(async () => {
          try {
            await fetchJobs()
            // 同时刷新诊断结果
            await refreshDiagnosticResults()
          } catch (error) {
            console.warn(t.delayedRefreshFailed + ':', error)
          }
        }, 2000) // 2秒后刷新
        
        // 显示成功消息
        alert(`${t.jobDeleteSuccess}: ${result.message}`)
      } else {
        throw new Error(result.error || t.deleteFailed)
      }
    } catch (error) {
      console.error(t.deleteFailed + ':', error)
      alert(`${t.deleteFailed}: ${error.message}`)
    }
  }

  // 初始化和刷新
  useEffect(() => {
    // 只在首次加载时执行，避免页面切换时重复刷新
    if (!hasInitialized) {
      setHasInitialized(true)
      // 不自动刷新，让用户手动选择何时刷新
      console.log(t.troubleshootingPageInitialized)
    } else {
      // 页面切换后，恢复状态并检查是否需要继续倒计时
      console.log(t.pageSwitchRestoreState)
      restoreRefreshState()
    }
  }, [hasInitialized])


  
  // 恢复刷新状态的函数
  const restoreRefreshState = () => {
    const now = Date.now()
    
    // 检查是否在冷却期内
    if (nextRefreshTime > 0 && now < nextRefreshTime) {
      const remainingTime = Math.ceil((nextRefreshTime - now) / 1000)
      console.log(`恢复冷却状态，剩余 ${remainingTime} 秒`)
      
      // 设置倒计时
      setGpuStatusCountdown(remainingTime)
      setGpuStatusRefreshDisabled(true)
      
      gpuStatusCountdownRef.current = window.setInterval(() => {
        setGpuStatusCountdown(prev => {
          if (prev <= 1) {
            setGpuStatusRefreshDisabled(false)
            setNextRefreshTime(0)
            if (gpuStatusCountdownRef.current) {
              clearInterval(gpuStatusCountdownRef.current)
              gpuStatusCountdownRef.current = null
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else if (lastRefreshTime > 0 && (now - lastRefreshTime) < 60000) {
      // 检查是否在正常冷却期内
      const timeSinceLastRefresh = now - lastRefreshTime
      const remainingTime = Math.ceil((60000 - timeSinceLastRefresh) / 1000)
      console.log(`恢复正常冷却状态，剩余 ${remainingTime} 秒`)
      
      // 设置倒计时
      setGpuStatusCountdown(remainingTime)
      setGpuStatusRefreshDisabled(true)
      
      gpuStatusCountdownRef.current = window.setInterval(() => {
        setGpuStatusCountdown(prev => {
          if (prev <= 1) {
            setGpuStatusRefreshDisabled(false)
            if (gpuStatusCountdownRef.current) {
              clearInterval(gpuStatusCountdownRef.current)
              gpuStatusCountdownRef.current = null
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      // 不在冷却期内，可以刷新
      setGpuStatusRefreshDisabled(false)
      setGpuStatusCountdown(0)
    }
    
    // 检查GPU节点数据状态
    if (gpuNodeStatus.length === 0) {
      console.log('GPU节点数据为空，尝试从localStorage恢复')
      const savedData = localStorage.getItem("gpu-node-status-data")
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData)
          if (parsedData && Array.isArray(parsedData) && parsedData.length > 0) {
            setGpuNodeStatus(parsedData)
            console.log(`从localStorage恢复了 ${parsedData.length} 个GPU节点数据`)
          }
        } catch (error) {
          console.error('恢复GPU节点数据失败:', error)
        }
      }
    } else {
      console.log(`GPU节点数据已存在，共 ${gpuNodeStatus.length} 个节点`)
    }
  }

  // 清理定时器
  useEffect(() => {
    return () => {
      if (gpuStatusCountdownRef.current) {
        clearInterval(gpuStatusCountdownRef.current)
      }
    }
  }, [])

  // 页面加载时自动获取诊断任务和诊断结果数据
  useEffect(() => {
    // 尝试从localStorage恢复数据
    const savedJobs = localStorage.getItem("diagnostic-jobs-data")
    const savedResults = localStorage.getItem("diagnostic-results-data")
    
    if (savedJobs && jobs.length === 0) {
      try {
        const parsedJobs = JSON.parse(savedJobs)
        if (parsedJobs && Array.isArray(parsedJobs)) {
          setJobs(parsedJobs)
          console.log(`从localStorage恢复了 ${parsedJobs.length} 个诊断任务`)
        }
      } catch (error) {
        console.error('恢复诊断任务数据失败:', error)
      }
    }
    
    if (savedResults && diagnosticResults.length === 0) {
      try {
        const parsedResults = JSON.parse(savedResults)
        if (parsedResults && Array.isArray(parsedResults)) {
          setDiagnosticResults(parsedResults)
          console.log(`从localStorage恢复了 ${parsedResults.length} 个诊断结果`)
        }
      } catch (error) {
        console.error('恢复诊断结果数据失败:', error)
      }
    }
    
    // 如果localStorage中没有数据，则自动获取
    if (jobs.length === 0) {
      console.log('自动获取诊断任务数据')
      fetchJobs()
    }
    
    if (diagnosticResults.length === 0) {
      console.log('自动获取诊断结果数据')
      refreshDiagnosticResults()
    }
  }, []) // 只在组件挂载时执行一次

  // 自动刷新诊断结果
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    
    if (showResults && diagnosticResults.length > 0) {
      // 每60秒自动刷新一次诊断结果，避免429错误
      interval = setInterval(async () => {
        try {
          console.log('自动刷新诊断结果...')
          const results = await getDiagnosticResults()
          if (results && Array.isArray(results) && results.length > 0) {
            setDiagnosticResults(results)
            console.log('诊断结果已更新:', results.length, '条记录')
          } else {
            console.log('自动刷新: 暂无诊断结果或结果格式不正确')
          }
        } catch (error: any) {
          console.log('自动刷新诊断结果失败:', error)
          // 如果是429错误，延长下次刷新时间
          if (error.message && error.message.includes('429')) {
            console.log('检测到429错误，延长下次刷新时间')
            // 清除当前定时器，延长到5分钟后再次尝试
            if (interval) {
              clearInterval(interval)
              setTimeout(() => {
                // 5分钟后重新启动自动刷新
                console.log('5分钟后重新启动自动刷新')
              }, 300000)
            }
          }
        }
      }, 60000) // 60秒
    }
    
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [showResults, diagnosticResults.length])

  // 格式化时间显示 - 与主页节点检查详情保持一致
  const formatTime = (timeStr: string | number | Date) => {
    if (!timeStr || timeStr === 'N/A') return 'N/A'
    
    // 如果是数字，可能是时间戳
    if (typeof timeStr === 'number') {
      try {
        const date = new Date(timeStr * 1000) // 假设是秒级时间戳
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })
        }
      } catch (e) {
        // 如果解析失败，返回原始值
      }
    }
    
    // 如果是字符串，尝试解析
    if (typeof timeStr === 'string') {
      // 如果是执行时长格式（如 0:00:00.143453），跳过不显示
      if (timeStr.includes(':') && timeStr.includes('.') && timeStr.startsWith('0:')) {
        return 'N/A' // 不显示执行时长
      }
      
      // 如果是ISO格式时间，转换为可读格式
      if (timeStr.includes('T')) {
        try {
          const date = new Date(timeStr)
          if (!isNaN(date.getTime())) {
            return date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          }
        } catch (e) {
          return 'N/A'
        }
      }
      
      // 尝试解析其他时间格式
      try {
        const date = new Date(timeStr)
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })
        }
      } catch (e) {
        // 如果解析失败，返回原始值
      }
    }
    
    return timeStr
  }

  // 格式化诊断结果显示，包含基准值对比
  const formatDiagnosticResult = (result: any, testType: string) => {
    if (!result || !result.originalResult) return 'N/A'
    
    const originalResult = result.originalResult
    let testValue: any
    let benchmarkValue: number | null = null
    
    // 根据测试类型获取对应的值和基准值
    switch (testType) {
      case 'bandwidth':
        testValue = originalResult.bandwidthTest
        benchmarkValue = originalResult.benchmarkData?.bw || originalResult.benchmark?.bw
        break
      case 'p2p':
        testValue = originalResult.p2pBandwidthLatencyTest
        benchmarkValue = originalResult.benchmarkData?.p2p || originalResult.benchmark?.p2p
        break
      case 'nccl':
        testValue = originalResult.ncclTests
        benchmarkValue = originalResult.benchmarkData?.nccl || originalResult.benchmark?.nccl
        break
      case 'dcgm':
        testValue = originalResult.dcgmDiag
        break
      case 'ib':
        testValue = originalResult.ibCheck
        break
      default:
        return 'N/A'
    }
    
    // 处理N/A值
    if (!testValue || testValue === 'N/A') return 'N/A'
    
    // 对于数值型测试，只显示数值，基准值会在表格中单独显示
    if (typeof testValue === 'string' && testValue.includes('GB/s')) {
      // 提取纯数值，去掉可能包含的基准值信息
      const cleanValue = testValue.split('(')[0].trim()
      return cleanValue
    }
    
    // 对于状态型测试，只显示状态
    if (testValue === 'Pass') {
      return testValue
    } else if (testValue === 'No Pass') {
      return testValue
    }
    
    return testValue
  }

  // 统一数据格式处理（移除复杂的转换逻辑）
  const getDisplayData = (result: any) => {
    if (!result) return null
    
    // 检查启用的测试项目
    const enabledTests = result.enabledTests || []
    const isDcgmEnabled = enabledTests.includes('dcgm')
    const isIbEnabled = enabledTests.includes('ib')
    
    // 直接使用统一的字段结构
    return {
      nodeName: result.nodeName || result.hostname || 'Unknown',
      gpuType: result.gpuType || 'Unknown',
      bandwidthTest: formatDiagnosticResult({ originalResult: result }, 'bandwidth'),
      p2pBandwidthLatencyTest: formatDiagnosticResult({ originalResult: result }, 'p2p'),
      ncclTests: formatDiagnosticResult({ originalResult: result }, 'nccl'),
      // DCGM和IB检查根据是否启用来决定显示内容
      dcgmDiag: isDcgmEnabled ? (result.dcgmDiag || 'N/A') : 'N/A',
      ibCheck: isIbEnabled ? (result.ibCheck || 'N/A') : 'N/A',
      timestamp: formatTime(calculateCompletionTime(result.createdAt, result.executionTime) || 'N/A'),
      // 创建时间应该显示Job的创建时间，而不是执行时长
      executionTime: formatTime(result.creationTimestamp || result.createdAt || result.timestamp || 'N/A'),
      executionLog: result.executionLog || 'N/A',
      // 保持原始数据用于状态判断
      originalResult: result
    }
  }

  // 刷新诊断结果
  const refreshDiagnosticResults = async () => {
    try {
      setResultsRefreshDisabled(true)
      setResultsCountdown(60) // 60秒冷却时间
      setResultsLastRefresh(Date.now())
      
      const results = await getDiagnosticResults()
      if (results && Array.isArray(results)) {
        setDiagnosticResults(results)
        
        // 保存到localStorage
        localStorage.setItem("diagnostic-results-data", JSON.stringify(results))
        console.log(`保存了 ${results.length} 个诊断结果到localStorage`)
        console.log('诊断结果刷新成功:', results.length, '条记录')
      }
    } catch (error: any) {
      console.error('刷新诊断结果失败:', error)
    } finally {
      setResultsRefreshDisabled(false)
      setResultsCountdown(0)
    }
  }

  // 状态徽章组件 - 与节点检查详情保持一致
  const StatusBadge = ({ status }: { status: string }) => {
    // 处理N/A值
    if (!status || status === 'N/A' || status === 'Unknown') {
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          <Minus className="w-3 h-3 mr-1" />
          N/A
        </Badge>
      )
    }
    
    // 处理通过/未通过状态 - 使用与节点检查详情一致的样式
    if (status === 'Pass' || status === '通过') {
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle className="w-3 h-3 mr-1" />
          {t.pass || '通过'}
        </Badge>
      )
    } else if (status === 'No Pass' || status === '未通过') {
      return (
        <Badge variant="destructive" className="dark:bg-red-900/20 dark:text-red-400">
          <XCircle className="w-3 h-3 mr-1" />
          {t.noPass || '未通过'}
        </Badge>
      )
    }
    
    // 其他状态
    return (
      <Badge variant="outline" className="text-gray-700 border-gray-300">
        {status}
      </Badge>
    )
  }

  // 诊断结果刷新倒计时
  useEffect(() => {
    if (resultsRefreshDisabled && resultsCountdown > 0) {
      const timer = window.setInterval(() => {
        setResultsCountdown(prev => {
          if (prev <= 1) {
            setResultsRefreshDisabled(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
      
      return () => clearInterval(timer)
    }
  }, [resultsRefreshDisabled, resultsCountdown])

  // 诊断任务管理相关状态
  const [jobSearchTerm, setJobSearchTerm] = useState("")
  const [selectedJobs, setSelectedJobs] = useState<string[]>([])
  const [jobPageSize, setJobPageSize] = useState(10)
  const [jobCurrentPage, setJobCurrentPage] = useState(1)

  return (
    <>
      {/* 统计概要（按节点空闲状态分类） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card
          className={`transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className={`text-sm font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
              {t.totalNodes}
            </CardTitle>
            <CheckCircle className={`h-4 w-4 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
              {gpuStatusSummary.totalNodes}
            </div>
            <p className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>{t.totalNodesDesc}</p>
          </CardContent>
        </Card>

        <Card
          className={`transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className={`text-sm font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
              {t.idleNodes}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold text-green-600 ${theme === "dark" ? "text-green-400" : ""}`}>
              {gpuStatusSummary.idleNodes}
            </div>
            <p className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>{t.idleNodesDesc}</p>
          </CardContent>
        </Card>

        <Card
          className={`transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className={`text-sm font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
              {t.busyNodes}
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold text-red-600 ${theme === "dark" ? "text-red-400" : ""}`}>
              {gpuStatusSummary.busyNodes}
            </div>
            <p className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>{t.busyNodesDesc}</p>
          </CardContent>
        </Card>
      </div>

      {/* GPU节点资源状态 */}
      <GpuStatusTable
        data={gpuNodeStatus}
        loading={gpuStatusLoading}
        searchTerm={gpuStatusSearchTerm}
        onSearchChange={setGpuStatusSearchTerm}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        currentPage={gpuStatusCurrentPage}
        pageSize={gpuStatusPageSize}
        onPageChange={handleGpuStatusPageChange}
        onPageSizeChange={handleGpuStatusPageSizeChange}
        theme={theme}
        t={t}
        lastRefreshTime={lastRefreshTime}
        gpuNodeStatus={gpuNodeStatus}
        mockGpuStatusData={mockGpuStatusData}
        gpuStatusRefreshDisabled={gpuStatusRefreshDisabled}
        nextRefreshTime={nextRefreshTime}
        gpuStatusCountdown={gpuStatusCountdown}
        refreshAttempts={refreshAttempts}
        autoRefreshEnabled={autoRefreshEnabled}
        onAutoRefreshToggle={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
        onRefresh={handleSmartRefresh}
        gpuStatusLoading={gpuStatusLoading}
        refreshError={refreshError}
        hasInitialized={hasInitialized}
        // 新增：优化后的刷新状态信息
        refreshState={refreshState}
        getNextRefreshTimeDisplay={getNextRefreshTimeDisplay}
        getCurrentRefreshIntervalDisplay={getCurrentRefreshIntervalDisplay}
      />

      {/* 节点选择和诊断配置 */}
      <Card
        className={`mt-6 transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <CardHeader>
          <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            {t.selfServiceDiagnostic}
          </CardTitle>
          <p className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
            {t.selfServiceDiagnosticDesc}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 节点选择 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-lg font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                {t.selectIdleNodes}
            </h3>
              {idleNodes.length > 0 && (
                <div className="flex items-center space-x-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedNodes.length === idleNodes.length) {
                        setSelectedNodes([])
                      } else {
                        setSelectedNodes(idleNodes.map(node => node.nodeName))
                      }
                    }}
                    className={`text-xs ${
                      theme === "dark" 
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                        : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                    }`}
                  >
                    {selectedNodes.length === idleNodes.length ? t.deselectAll : t.selectAll}
                  </Button>
                  <span className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                    {t.selected} {selectedNodes.length} / {idleNodes.length}
                  </span>
                </div>
              )}
            </div>
            
            {idleNodes.length === 0 ? (
              <div
                className={`p-4 rounded-md border-2 border-dashed ${theme === "dark" ? "border-gray-600 text-gray-400" : "border-gray-300 text-gray-500"}`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span>{t.noIdleNodes}</span>
                </div>
              </div>
            ) : (
              <>
                {/* 搜索框 */}
                <div className="mb-4">
                  <Input
                    placeholder={t.searchHostname}
                    value={nodeSearchTerm}
                    onChange={(e) => setNodeSearchTerm(e.target.value)}
                    className={`max-w-sm ${
                      theme === "dark" 
                        ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400" 
                        : ""
                    }`}
                  />
                </div>
                
                {/* 节点列表 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {paginatedIdleNodes.map((node) => (
                  <div
                    key={node.nodeName}
                    className={`p-3 rounded-md border transition-colors ${
                      selectedNodes.includes(node.nodeName)
                        ? theme === "dark"
                          ? "border-blue-500 bg-blue-900/20"
                          : "border-blue-500 bg-blue-50"
                        : theme === "dark"
                          ? "border-gray-600 hover:border-gray-500"
                          : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        checked={selectedNodes.includes(node.nodeName)}
                        onCheckedChange={(checked) => handleNodeSelection(node.nodeName, checked as boolean)}
                      />
                      <div className="flex-1">
                        <div className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                          {node.nodeName}
                        </div>
                        <div className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                          {node.gpuType} • <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{node.nodeStatus === 'idle' ? 8 : 0}</span> GPUs
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-green-600 bg-green-100">
                        空闲
                      </Badge>
                    </div>
                  </div>
                ))}
                </div>
                
                {/* 分页控件 - 常驻显示 */}
                <div className="mt-4 flex items-center justify-between">
                  <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    {t.display} {startNodeIndex + 1}-{Math.min(endNodeIndex, filteredIdleNodes.length)} {t.of} {filteredIdleNodes.length} {t.records}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.displayPerPage}:
                    </span>
                    <select
                      value={nodePageSize}
                      onChange={(e) => {
                        setNodePageSize(Number(e.target.value))
                        setNodeCurrentPage(1) // 重置到第一页
                      }}
                      className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 ${
                        theme === "dark" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <option value={6}>6 {t.rows}</option>
                      <option value={12}>12 {t.rows}</option>
                      <option value={24}>24 {t.rows}</option>
                      <option value={48}>48 {t.rows}</option>
                    </select>
                  </div>
                </div>
                
                {/* 分页导航 - 常驻显示 */}
                <div className="mt-2 flex items-center justify-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNodeCurrentPage(Math.max(1, nodeCurrentPage - 1))}
                    disabled={nodeCurrentPage === 1}
                    className={`text-xs ${
                      theme === "dark" 
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                        : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                    }`}
                  >
                    {t.previousPage}
                  </Button>
                  
                  {/* 页码按钮 */}
                  {Array.from({ length: Math.min(5, totalNodePages) }, (_, i) => {
                    let pageNum
                    if (totalNodePages <= 5) {
                      pageNum = i + 1
                    } else if (nodeCurrentPage <= 3) {
                      pageNum = i + 1
                    } else if (nodeCurrentPage >= totalNodePages - 2) {
                      pageNum = totalNodePages - 4 + i
                    } else {
                      pageNum = nodeCurrentPage - 2 + i
                    }
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === nodeCurrentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNodeCurrentPage(pageNum)}
                        className={`text-xs ${
                          pageNum === nodeCurrentPage
                            ? "bg-blue-600 text-white"
                            : theme === "dark"
                              ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                              : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                        }`}
                      >
                        {pageNum}
                      </Button>
                    )
                  })}
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNodeCurrentPage(Math.min(totalNodePages, nodeCurrentPage + 1))}
                    disabled={nodeCurrentPage === totalNodePages}
                    className={`text-xs ${
                      theme === "dark" 
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                        : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                    }`}
                  >
                    {t.nextPage}
                  </Button>
                </div>
                
                {/* 搜索结果提示 */}
                {filteredIdleNodes.length === 0 && nodeSearchTerm && (
                  <div className={`mt-4 p-3 rounded-md border-2 border-dashed ${
                    theme === "dark" ? "border-gray-600 text-gray-400" : "border-gray-300 text-gray-500"
                  }`}>
                    <div className="text-center">
                      <span>{t.noMatchingHostname}: "{nodeSearchTerm}"</span>
                    </div>
              </div>
                )}
              </>
            )}
          </div>

          {/* 检查项目选择 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-lg font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                {t.selectCheckItems}
            </h3>
              {currentCheckItems.length > 0 && (
                <div className="flex items-center space-x-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedCheckItems.length === currentCheckItems.length) {
                        setSelectedCheckItems([])
                      } else {
                        setSelectedCheckItems(currentCheckItems.map(item => item.id))
                      }
                    }}
                    className={`text-xs ${
                      theme === "dark" 
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                        : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                    }`}
                  >
                    {selectedCheckItems.length === currentCheckItems.length ? t.deselectAll : t.selectAll}
                  </Button>
                  <span className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                    {t.selected} {selectedCheckItems.length} / {currentCheckItems.length}
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentCheckItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-md border transition-colors ${
                    selectedCheckItems.includes(item.id)
                      ? theme === "dark"
                        ? "border-blue-500 bg-blue-900/20"
                        : "border-blue-500 bg-blue-50"
                      : theme === "dark"
                        ? "border-gray-600 hover:border-gray-500"
                        : "border-gray-300 hover:border-gray-400"
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      checked={selectedCheckItems.includes(item.id)}
                      onCheckedChange={(checked) => handleCheckItemSelection(item.id, checked as boolean)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                        {item.label}
                      </div>
                      <div className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DCGM级别选择 */}
          {selectedCheckItems.includes("dcgmDiag") && (
            <div>
              <h3 className={`text-lg font-medium mb-3 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                {t.dcgmDiagnosticLevel}
              </h3>
              <div className="flex items-center space-x-4">
                {[1, 2, 3, 4].map((level) => (
                  <div key={level} className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id={`dcgm-${level}`}
                      name="dcgmLevel"
                      value={level}
                      checked={dcgmLevel === level}
                      onChange={(e) => setDcgmLevel(Number(e.target.value))}
                      className={`w-5 h-5 ${
                        theme === "dark" 
                          ? "text-blue-600 bg-gray-800 border-2 border-gray-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800" 
                          : "text-blue-600 bg-white border-2 border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white"
                      }`}
                    />
                    <label htmlFor={`dcgm-${level}`} className={`text-sm font-medium ${
                      theme === "dark" 
                        ? "text-white cursor-pointer" 
                        : "text-gray-700 cursor-pointer"
                    }`}>
                      {t[`level${level}`]}
                    </label>
                  </div>
                ))}
              </div>
              <p className={`text-xs mt-2 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                {t.level1}：{t.level1Desc}，{t.level2}：{t.level2Desc}，{t.level3}：{t.level3Desc}，{t.level4}：{t.level4Desc}
              </p>
            </div>
          )}

          {/* 开始诊断按钮 */}
          <div className="flex justify-center">
            <Button
              variant="default"
              onClick={handleCreateJob}
              disabled={selectedNodes.length === 0 || selectedCheckItems.length === 0 || jobLoading}
              className="px-8 py-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {jobLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  {t.diagnosticRunning}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  {t.startDiagnostic}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 诊断任务管理 */}
        <Card
          className={`mt-6 transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <CardHeader>
          <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            {t.diagnosticTaskManagement}
          </CardTitle>
                      <p className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
            {t.diagnosticTaskManagementDesc}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Input
                placeholder={t.searchJobIdOrNodeName}
                value={jobSearchTerm}
                onChange={(e) => setJobSearchTerm(e.target.value)}
                className="w-64"
                title={t.searchJobIdOrNodeNameTooltip}
              />
                    </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={fetchJobs}
                disabled={refreshing}
                className={`${
                  refreshing
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {refreshing ? t.refreshTaskListLoading : t.refreshTaskList}
              </Button>
              <Button
                variant="destructive"
                onClick={deleteSelectedJobs}
                disabled={selectedJobs.length === 0}
                className={`${
                  theme === "dark" 
                    ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                    : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                }`}
              >
                {t.deleteSelected} ({selectedJobs.length})
              </Button>
                  </div>
                      </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {/* 全选控制 */}
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={selectedJobs.length === jobs.length && jobs.length > 0}
                onChange={toggleSelectAllJobs}
                className="rounded border-gray-300"
              />
              <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                {t.selectAll}
                        </span>
                        </div>

            {/* 诊断任务表格 */}
            <div className={`border rounded-lg overflow-hidden transition-colors duration-200 ${
              theme === "dark" ? "border-gray-700" : "border-gray-200"
            }`}>
              <Table>
                <TableHeader>
                  <TableRow className={theme === "dark" ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-50"}>
                    <TableHead className={`w-12 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      <input
                        type="checkbox"
                        checked={selectedJobs.length === jobs.length && jobs.length > 0}
                        onChange={toggleSelectAllJobs}
                        className={`rounded ${theme === "dark" ? "border-gray-500 bg-gray-600" : "border-gray-300"}`}
                      />
                    </TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.jobId}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.status}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.node}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.testItems}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.dcgmLevel}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.creationTime}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.operation}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        {t.noTaskRecords}
                      </TableCell>
                    </TableRow>
                  ) : (
                    jobs
                      .filter(job => {
                        const searchTerm = jobSearchTerm.toLowerCase()
                        return job.jobId?.toLowerCase().includes(searchTerm) || 
                               job.selectedNodes?.some((node: string) => node.toLowerCase().includes(searchTerm))
                      })
                      .map((job, index) => (
                        <TableRow key={index} className={theme === "dark" ? "border-gray-700 hover:bg-gray-800" : "border-gray-200 hover:bg-gray-50"}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedJobs.includes(job.jobId)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedJobs(prev => [...prev, job.jobId])
                                } else {
                                  setSelectedJobs(prev => prev.filter(id => id !== job.jobId))
                                }
                              }}
                              className="rounded border-gray-300"
                            />
                          </TableCell>
                          <TableCell className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                            {job.jobId}
                          </TableCell>
                          <TableCell>
                            {/* 直接显示Pod状态 */}
                            <Badge variant={
                              (() => {
                                const lowerStatus = job.status?.toLowerCase()
                                if (lowerStatus === 'unknown') {
                                  return 'outline'
                                } else if (lowerStatus === 'pending' || lowerStatus === 'running' || lowerStatus === 'creating') {
                                  return 'secondary'
                                } else if (lowerStatus === 'completed' || lowerStatus === 'succeeded' || lowerStatus === 'failed') {
                                  return 'default'
                                } else if (lowerStatus === 'failed' || lowerStatus?.includes('failed')) {
                                  return 'destructive'
                                }
                                return 'secondary'
                              })()
                            }>
                              {job.status || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                            {job.selectedNodes?.join(', ') || 'N/A'}
                          </TableCell>
                          <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                            {job.enabledTests?.join(', ') || 'N/A'}
                          </TableCell>
                          <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                            {job.enabledTests && job.enabledTests.includes('dcgmDiag') ? (job.dcgmLevel || 1) : 'N/A'}
                          </TableCell>
                          <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                            {formatTime(job.creationTimestamp || job.createdAt || 'N/A')}
                          </TableCell>
                          <TableCell>
                            <div className="flex space-x-2">
                              {/* 停止按钮 - 对于活动状态的Job显示 */}
                              {(() => {
                                const lowerStatus = job.status?.toLowerCase()
                                return lowerStatus === 'pending' || lowerStatus === 'running' || lowerStatus === 'creating'
                              })() && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleStopJob(job.jobId)}
                                  className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                  {t.stop}
                                </Button>
                              )}
                              
                              {/* 删除按钮 - 只有在完成或失败的Job才能删除 */}
                              {(() => {
                                const lowerStatus = job.status?.toLowerCase()
                                return lowerStatus === 'completed' || lowerStatus === 'succeeded' || lowerStatus === 'failed' ||
                                       lowerStatus === 'cancelled' || lowerStatus === 'unknown'
                              })() && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => deleteJob(job.jobId)}
                                  className="bg-gray-600 hover:bg-gray-700 text-white border-gray-600"
                                >
                                  {t.delete}
                                </Button>
                              )}
                      </div>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
                      </div>

            {/* 分页控制 */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                  {jobs.length === 0 
                    ? t.noRecords 
                    : `${t.display}1-${jobs.length}${t.items}, ${t.total}${jobs.length}${t.records}`
                  }
                  </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                    {t.displayPerPage}:
                  </span>
                  <select
                    value={jobPageSize}
                    onChange={(e) => setJobPageSize(Number(e.target.value))}
                    className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 cursor-pointer ${
                      theme === "dark" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-300 bg-white text-gray-700"
                    }`}
                    style={{ pointerEvents: 'auto', zIndex: 10 }}
                  >
                    <option value={5}>5{t.rows}</option>
                    <option value={10}>10{t.rows}</option>
                    <option value={20}>20{t.rows}</option>
                  </select>
                </div>
            </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setJobCurrentPage(Math.max(1, jobCurrentPage - 1))}
                  disabled={jobCurrentPage === 1 || jobs.length === 0}
                  className={`${
                    theme === "dark" 
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {t.previousPage}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`${
                    theme === "dark" 
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {jobCurrentPage}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setJobCurrentPage(jobCurrentPage + 1)}
                  disabled={jobCurrentPage * jobPageSize >= jobs.length || jobs.length === 0}
                  className={`${
                    theme === "dark" 
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {t.nextPage}
                </Button>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

          {/* 诊断结果管理 */}
      <Card
        className={`mt-6 transition-colors duration-200 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <CardHeader>
          <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            {t.diagnosticResultManagement}
          </CardTitle>
          <p className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
            {t.diagnosticResultManagementDesc}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Input
                placeholder={t.searchJobIdOrHostname}
                value={resultSearchTerm}
                onChange={(e) => setResultSearchTerm(e.target.value)}
                className="w-80"
                title={t.searchJobIdOrHostnameTooltip}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={refreshDiagnosticResults}
                disabled={resultsRefreshDisabled}
                className={`${
                  resultsRefreshDisabled
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {resultsRefreshDisabled ? `${resultsCountdown}s` : t.refresh}
              </Button>
              <Button
                variant="outline"
                onClick={exportSelectedResults}
                disabled={selectedResults.length === 0}
                className={`${
                  theme === "dark" 
                    ? "border-green-600 text-green-400 hover:bg-green-700 bg-gray-800" 
                    : "border-green-600 text-green-600 hover:bg-green-100 bg-white"
                }`}
              >
                <Download className="w-4 h-4 mr-2" />
                {t.exportSelected} ({selectedResults.length})
              </Button>
              <Button
                variant="destructive"
                onClick={deleteSelectedResults}
                disabled={selectedResults.length === 0}
                className={`${
                  theme === "dark" 
                    ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800" 
                    : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                }`}
              >
                {t.deleteSelected} ({selectedResults.length})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {/* 全选控制 */}
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={selectedResults.length === diagnosticResults.length && diagnosticResults.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-gray-300"
              />
              <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                {t.selectAll}
              </span>
            </div>

            {/* 诊断结果表格 */}
            <div className={`rounded-md border transition-colors duration-200 ${
              theme === "dark" ? "border-gray-700" : "border-gray-200"
            }`}>
            <Table>
              <TableHeader>
                <TableRow className={theme === "dark" ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-50"}>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={selectedResults.length === diagnosticResults.length && diagnosticResults.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                  </TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>Job ID</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.hostName}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.gpuType}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>bandwidthTest</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>p2pBandwidthLatencyTest</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.ncclTests}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.dcgmDiag}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.ibCheck}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.nodeStatus}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.executionLog}</TableHead>
                    <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.completionTime}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {diagnosticResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-gray-500 dark:text-gray-400">
                        暂无诊断结果
                      </TableCell>
                    </TableRow>
                  ) : (
                    diagnosticResults
                      .filter(result => {
                        const convertedResult = getDisplayData(result)
                        if (!convertedResult) return false
                        
                        // 支持Job ID和主机名称搜索
                        const searchTerm = resultSearchTerm.toLowerCase()
                        const jobId = result.jobId?.toLowerCase() || ''
                        const nodeName = convertedResult.nodeName?.toLowerCase() || ''
                        
                        return jobId.includes(searchTerm) || nodeName.includes(searchTerm)
                      })
                      .slice((resultsCurrentPage - 1) * resultsPageSize, resultsCurrentPage * resultsPageSize)
                      .map((result, index) => {
                        const convertedResult = getDisplayData(result)
                        if (!convertedResult) return null
                        
                  return (
                    <TableRow
                            key={index}
                            className={theme === "dark" ? "hover:bg-gray-700 border-gray-700" : "hover:bg-gray-50"}
                          >
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedResults.includes(result.jobId)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedResults(prev => [...prev, result.jobId])
                                  } else {
                                    setSelectedResults(prev => prev.filter(id => id !== result.jobId))
                                  }
                                }}
                                className="rounded border-gray-300"
                              />
                            </TableCell>
                            <TableCell className={`font-mono text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                              {result.jobId}
                            </TableCell>
                            <TableCell className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                              {convertedResult.nodeName}
                            </TableCell>
                            <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                              {convertedResult.gpuType}
                            </TableCell>
                            <TableCell>
                              <PerformanceCell 
                                value={convertedResult.bandwidthTest} 
                                gpuType={convertedResult.gpuType} 
                                testType="bw" 
                                theme={theme}
                                t={t}
                              />
                            </TableCell>
                            <TableCell>
                              <PerformanceCell 
                                value={convertedResult.p2pBandwidthLatencyTest} 
                                gpuType={convertedResult.gpuType} 
                                testType="p2p" 
                                theme={theme}
                                t={t}
                              />
                            </TableCell>
                            <TableCell>
                              <PerformanceCell 
                                value={convertedResult.ncclTests} 
                                gpuType={convertedResult.gpuType} 
                                testType="nccl" 
                                theme={theme}
                                t={t}
                              />
                            </TableCell>
                            <TableCell>
                              {convertedResult.originalResult.enabledTests?.includes('dcgm') ? (
                                <StatusBadge status={convertedResult.dcgmDiag} />
                              ) : (
                                <span className="text-gray-400 text-sm">未选择</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {convertedResult.originalResult.enabledTests?.includes('ib') ? (
                                <StatusBadge status={convertedResult.ibCheck} />
                              ) : (
                                <span className="text-gray-400 text-sm">未选择</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={getNodeStatus(convertedResult.originalResult)} />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => viewResult(result)}
                      className={`${
                                  theme === "dark"
                                    ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                                    : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                                }`}
                              >
                                <FileText className="w-4 h-4 mr-1" />
                                {t.viewLog}
                              </Button>
                      </TableCell>
                            <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                              {convertedResult.executionTime}
                            </TableCell>
                    </TableRow>
                  )
                    })
                  )}
              </TableBody>
            </Table>
          </div>

            {/* 分页控制 - 始终显示 */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                  {(() => {
                    const filteredResults = diagnosticResults.filter(result => {
                      const convertedResult = getDisplayData(result)
                      if (!convertedResult) return false
                      
                      const searchTerm = resultSearchTerm.toLowerCase()
                      const jobId = result.jobId?.toLowerCase() || ''
                      const nodeName = convertedResult.nodeName?.toLowerCase() || ''
                      
                      return jobId.includes(searchTerm) || nodeName.includes(searchTerm)
                    })
                    
                    if (filteredResults.length === 0) {
                      return t.noRecords
                    }
                    
                    const startIndex = (resultsCurrentPage - 1) * resultsPageSize + 1
                    const endIndex = Math.min(resultsCurrentPage * resultsPageSize, filteredResults.length)
                    
                    return `${t.display}${startIndex}-${endIndex}${t.items}, ${t.total}${filteredResults.length}${t.records}`
                  })()}
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                    {t.displayPerPage}:
                  </span>
                  <select
                    value={resultsPageSize}
                    onChange={(e) => setResultsPageSize(Number(e.target.value))}
                    className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 cursor-pointer ${
                      theme === "dark" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-300 bg-white text-gray-700"
                    }`}
                    style={{ pointerEvents: 'auto', zIndex: 10 }}
                  >
                    <option value={5}>5{t.rows}</option>
                    <option value={10}>10{t.rows}</option>
                    <option value={20}>20{t.rows}</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResultsCurrentPage(Math.max(1, resultsCurrentPage - 1))}
                  disabled={(() => {
                    const filteredResults = diagnosticResults.filter(result => {
                      const convertedResult = getDisplayData(result)
                      if (!convertedResult) return false
                      
                      const searchTerm = resultSearchTerm.toLowerCase()
                      const jobId = result.jobId?.toLowerCase() || ''
                      const nodeName = convertedResult.nodeName?.toLowerCase() || ''
                      
                      return jobId.includes(searchTerm) || nodeName.includes(searchTerm)
                    })
                    return resultsCurrentPage === 1 || filteredResults.length === 0
                  })()}
                  className={`px-3 py-1 ${
                    theme === "dark"
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {t.previousPage}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`px-3 py-1 ${
                    theme === "dark"
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {resultsCurrentPage}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResultsCurrentPage(resultsCurrentPage + 1)}
                  disabled={(() => {
                    const filteredResults = diagnosticResults.filter(result => {
                      const convertedResult = getDisplayData(result)
                      if (!convertedResult) return false
                      
                      const searchTerm = resultSearchTerm.toLowerCase()
                      const jobId = result.jobId?.toLowerCase() || ''
                      const nodeName = convertedResult.nodeName?.toLowerCase() || ''
                      
                      return jobId.includes(searchTerm) || nodeName.includes(searchTerm)
                    })
                    return resultsCurrentPage * resultsPageSize >= filteredResults.length || filteredResults.length === 0
                  })()}
                  className={`px-3 py-1 ${
                    theme === "dark"
                      ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                      : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {t.nextPage}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 诊断结果日志查看对话框 - 与节点检查详情保持一致 */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent
          className={`max-w-5xl max-h-[90vh] ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white"}`}
        >
          <DialogHeader>
            <DialogTitle className={theme === "dark" ? "text-white" : "text-gray-900"}>
              {t.diagnosticResultDetails}
            </DialogTitle>
            <DialogDescription className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
              {t.diagnosticResultDetailsDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[calc(90vh-200px)] overflow-y-auto">
            {selectedResult && (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.node}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedResult.nodeName || selectedResult.hostname}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.gpuType}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedResult.gpuType}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.jobId}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedResult.jobId}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.dcgmDiagnosticLevel}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedResult.enabledTests && selectedResult.enabledTests.includes('dcgmDiag') ? (selectedResult.dcgmLevel || 1) : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.completionTime || "完成时间"}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {formatTime(calculateCompletionTime(selectedResult.createdAt, selectedResult.executionTime) || 'N/A')}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.overallResult}:
                    </span>
                    <span className={`ml-2`}>
                      <StatusBadge status={selectedResult.inspectionResult} />
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.executionLog}:
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportDiagnosticLog(selectedResult)}
                      className={`${
                        theme === "dark"
                          ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                          : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                      }`}
                    >
                      <Download className="w-4 w-4 mr-1" />
                      {t.exportLog}
                    </Button>
                  </div>

                  <ScrollArea
                    className={`h-80 w-full rounded-md border p-4 ${
                      theme === "dark" ? "border-gray-600 bg-gray-700" : "border-gray-300 bg-gray-50"
                    }`}
                  >
                    <pre
                      className={`text-sm whitespace-pre-wrap ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}
                    >
                      {selectedResult.executionLog || t.noLog}
                    </pre>
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
