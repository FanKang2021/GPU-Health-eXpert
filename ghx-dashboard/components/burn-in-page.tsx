"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Play,
  Square,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Thermometer,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Monitor,
  Activity,
  Cpu,
  Info,
  Settings,
} from "lucide-react"

interface BurnInPageProps {
  language: "zh" | "en"
  t: any
}

interface GpuBurnData {
  nodeId: string
  nodeName: string
  progress: number
  gpus: {
    id: number
    activeUnits: number
    gflops: number
    errors: number
    temperature: number
  }[]
  status: "idle" | "running" | "completed" | "failed"
  startTime?: string
  endTime?: string
  finalResult?: {
    [key: number]: "OK" | "FAIL"
  }
}

const mockIdleNodes = [
  { nodeId: "node-001", nodeName: "gpu-node-001", gpuType: "H200", gpuCount: 8, status: "idle" },
  { nodeId: "node-002", nodeName: "gpu-node-002", gpuType: "H100", gpuCount: 8, status: "idle" },
  { nodeId: "node-003", nodeName: "gpu-node-003", gpuType: "A100", gpuCount: 8, status: "idle" },
  { nodeId: "node-004", nodeName: "gpu-node-004", gpuType: "H800", gpuCount: 8, status: "idle" },
  { nodeId: "node-005", nodeName: "gpu-node-005", gpuType: "H200", gpuCount: 8, status: "idle" },
  { nodeId: "node-006", nodeName: "gpu-node-006", gpuType: "H100", gpuCount: 8, status: "idle" },
  { nodeId: "node-007", nodeName: "gpu-node-007", gpuType: "A100", gpuCount: 8, status: "idle" },
  { nodeId: "node-008", nodeName: "gpu-node-008", gpuType: "H800", gpuCount: 8, status: "idle" },
  { nodeId: "node-009", nodeName: "gpu-node-009", gpuType: "H200", gpuCount: 8, status: "idle" },
  { nodeId: "node-010", nodeName: "gpu-node-010", gpuType: "H100", gpuCount: 8, status: "idle" },
  { nodeId: "node-011", nodeName: "gpu-node-011", gpuType: "A100", gpuCount: 8, status: "idle" },
  { nodeId: "node-012", nodeName: "gpu-node-012", gpuType: "H800", gpuCount: 8, status: "idle" },
  { nodeId: "node-013", nodeName: "gpu-node-013", gpuType: "H200", gpuCount: 8, status: "idle" },
  { nodeId: "node-014", nodeName: "gpu-node-014", gpuType: "H100", gpuCount: 8, status: "idle" },
  { nodeId: "node-015", nodeName: "gpu-node-015", gpuType: "A100", gpuCount: 8, status: "idle" },
]

const generateMockBurnData = (nodeId: string, nodeName: string): GpuBurnData => {
  const progress = Math.floor(Math.random() * 100)

  const gpus = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    activeUnits: Math.floor(Math.random() * 1000) + 2000,
    gflops: Math.floor(Math.random() * 10000) + 50000,
    errors: Math.random() < 0.95 ? 0 : Math.floor(Math.random() * 3),
    temperature: Math.floor(Math.random() * 30) + 50,
  }))

  return {
    nodeId,
    nodeName,
    progress,
    gpus,
    status: "running",
    startTime: new Date().toISOString(),
  }
}

export default function BurnInPage({ language, t }: BurnInPageProps) {
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(6)
  const [runningTests, setRunningTests] = useState<Map<string, GpuBurnData>>(new Map())
  const [completedTests, setCompletedTests] = useState<GpuBurnData[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // 参数设置状态
  const [memoryType, setMemoryType] = useState<"fixed" | "percentage">("percentage")
  const [memoryValue, setMemoryValue] = useState("80")
  const [testDuration, setTestDuration] = useState("30")
  const [pollingInterval, setPollingInterval] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('burnin-polling-interval') || "2"
    }
    return "2"
  }) // 轮询间隔（秒）
  const [pollingEnabled, setPollingEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('burnin-polling-enabled') !== 'false'
    }
    return true
  }) // 轮询是否启用
  
  // 节点状态管理
  const [idleNodes, setIdleNodes] = useState(mockIdleNodes)
  const [loading, setLoading] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<number>(0)
  const [refreshDisabled, setRefreshDisabled] = useState(false)
  const [countdown, setCountdown] = useState<number>(0)
  
  // API配置
  const API_BASE_URL = typeof window !== "undefined" && (window as any).NEXT_PUBLIC_API_URL ? (window as any).NEXT_PUBLIC_API_URL : "http://localhost:5000"

  // 刷新空闲节点功能
  const refreshIdleNodes = async () => {
    const now = Date.now()
    const timeSinceLastRefresh = now - lastRefresh
    const cooldownPeriod = 20000 // 20秒冷却时间

    // 检查是否在冷却期内
    if (timeSinceLastRefresh < cooldownPeriod && !refreshDisabled) {
      const remainingTime = Math.ceil((cooldownPeriod - timeSinceLastRefresh) / 1000)
      setRefreshError(`请等待 ${remainingTime} 秒后再试`)
      return
    }

    setLoading(true)
    setLastRefresh(now)
    setRefreshDisabled(true)
    setRefreshError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu-inspection/node-status`)
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : cooldownPeriod
        setRefreshError(`API请求过于频繁，请等待 ${Math.ceil(waitTime / 1000)} 秒后再试`)
        
        let countdown = Math.ceil(waitTime / 1000)
        setCountdown(countdown)
        const interval = setInterval(() => {
          countdown -= 1
          setCountdown(countdown)
          if (countdown <= 0) {
            setRefreshDisabled(false)
            clearInterval(interval)
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
      const idleNodesData = nodes
        .filter((node: any) => node.nodeStatus === 'idle')
        .map((node: any, index: number) => ({
          nodeId: `node-${index}`,
          nodeName: node.nodeName,
          gpuType: node.gpuType || 'Unknown',
          gpuCount: 8, // 空闲节点显示8个可用GPU
          status: 'idle' as const
        }))
      
      setIdleNodes(idleNodesData)
      console.log(`成功获取 ${idleNodesData.length} 个空闲节点`)
      
      // 成功后的倒计时
      let countdown = 20
      setCountdown(countdown)
      const interval = setInterval(() => {
        countdown -= 1
        setCountdown(countdown)
        if (countdown <= 0) {
          setRefreshDisabled(false)
          clearInterval(interval)
        }
      }, 1000)
      
    } catch (err: any) {
      const errorMessage = err.message || '获取GPU节点状态失败'
      setRefreshError(errorMessage)
      console.error('刷新空闲节点失败:', errorMessage)
      
      // 如果API失败，使用mock数据
      setIdleNodes(mockIdleNodes)
    } finally {
      setLoading(false)
    }
  }

  const filteredNodes = idleNodes.filter((node) => node.nodeName.toLowerCase().includes(searchTerm.toLowerCase()))
  const totalPages = Math.ceil(filteredNodes.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentNodes = filteredNodes.slice(startIndex, startIndex + itemsPerPage)

  const handleNodeSelection = (nodeId: string, checked: boolean) => {
    if (checked) {
      setSelectedNodes([...selectedNodes, nodeId])
    } else {
      setSelectedNodes(selectedNodes.filter((id) => id !== nodeId))
    }
  }

  const handleSelectAll = () => {
    if (selectedNodes.length === currentNodes.length) {
      setSelectedNodes([])
    } else {
      setSelectedNodes(currentNodes.map((node) => node.nodeId))
    }
  }

  // 实际的烧机测试API调用
  const startBurnInTest = async () => {
    if (selectedNodes.length === 0) {
      console.error('请选择至少一个节点')
      return
    }

    try {
      setLoading(true)
      
      // 为每个选中的节点创建烧机测试
      for (const nodeId of selectedNodes) {
        const node = idleNodes.find((n) => n.nodeId === nodeId)
        if (!node) continue

        const response = await fetch(`${API_BASE_URL}/api/burnin/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nodeName: node.nodeName,
            memoryType: memoryType,
            memoryValue: parseInt(memoryValue),
            duration: parseInt(testDuration) * 60 // 转换为秒
          })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
        }

        const result = await response.json()
        if (result.success) {
          console.log(`烧机测试创建成功: ${node.nodeName} - Job ID: ${result.job_id}`)
          
          // 添加到运行中的测试
          const newTests = new Map(runningTests)
          newTests.set(nodeId, {
            nodeId: nodeId,
            nodeName: node.nodeName,
            progress: 0,
            gpus: [],
            status: 'running',
            startTime: new Date().toISOString(),
            jobId: result.job_id
          })
          setRunningTests(newTests)
        } else {
          throw new Error(result.error || '创建烧机测试失败')
        }
      }
      
      setSelectedNodes([])
      console.log('所有烧机测试已启动')
      
    } catch (error: any) {
      console.error('启动烧机测试失败:', error)
      setRefreshError(`启动烧机测试失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const stopBurnInTest = async (nodeId: string) => {
    const testData = runningTests.get(nodeId)
    if (!testData || !testData.jobId) {
      console.error('未找到测试数据或Job ID')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/burnin/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job_id: testData.jobId
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      if (result.success) {
        console.log(`烧机测试停止成功: ${testData.nodeName}`)
        
        // 更新测试状态
        const newTests = new Map(runningTests)
        const updatedTestData = { ...testData, status: 'completed' as const, endTime: new Date().toISOString() }
        setCompletedTests((prev) => [...prev, updatedTestData])
        newTests.delete(nodeId)
        setRunningTests(newTests)
      } else {
        throw new Error(result.error || '停止烧机测试失败')
      }
      
    } catch (error: any) {
      console.error('停止烧机测试失败:', error)
      setRefreshError(`停止烧机测试失败: ${error.message}`)
    }
  }

  // 手动刷新烧机测试状态
  const refreshBurnInStatus = async () => {
    if (runningTests.size === 0) return

    try {
      for (const [nodeId, testData] of runningTests.entries()) {
        if (testData.jobId) {
          const response = await fetch(`${API_BASE_URL}/api/burnin/jobs/${testData.jobId}`)
          if (response.ok) {
            const result = await response.json()
            if (result.success && result.job) {
              const newTests = new Map(runningTests)
              const updatedTestData = {
                ...testData,
                progress: result.job.progress || 0,
                gpus: result.job.gpus || [],
                status: result.job.status === 'completed' ? 'completed' : 'running'
              }
              
              if (updatedTestData.status === 'completed') {
                setCompletedTests(prev => [...prev, { ...updatedTestData, endTime: new Date().toISOString() }])
                newTests.delete(nodeId)
              } else {
                newTests.set(nodeId, updatedTestData)
              }
              
              setRunningTests(newTests)
            }
          }
        }
      }
    } catch (error) {
      console.error('手动刷新烧机测试状态失败:', error)
    }
  }

  const stopAllTests = async () => {
    if (runningTests.size === 0) return

    try {
      // 并行停止所有测试
      const stopPromises = Array.from(runningTests.entries()).map(async ([nodeId, testData]) => {
        if (!testData.jobId) return

        try {
          const response = await fetch(`${API_BASE_URL}/api/burnin/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              job_id: testData.jobId
            })
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              console.log(`烧机测试停止成功: ${testData.nodeName}`)
              return { nodeId, success: true }
            } else {
              console.error(`烧机测试停止失败: ${testData.nodeName} - ${result.error}`)
              return { nodeId, success: false, error: result.error }
            }
          } else {
            const errorData = await response.json()
            console.error(`烧机测试停止失败: ${testData.nodeName} - HTTP ${response.status}`)
            return { nodeId, success: false, error: errorData.error || `HTTP ${response.status}` }
          }
        } catch (error) {
          console.error(`停止测试时发生错误: ${testData.nodeName}`, error)
          return { nodeId, success: false, error: error.message }
        }
      })

      // 等待所有停止操作完成
      const results = await Promise.all(stopPromises)
      
      // 统计结果
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length
      
      console.log(`停止所有测试完成: 成功 ${successCount} 个, 失败 ${failCount} 个`)
      
      // 更新前端状态
      const newCompleted = [...completedTests]
      runningTests.forEach((testData) => {
        const result = results.find(r => r.nodeId === testData.nodeId)
        const updatedTestData = {
          ...testData,
          status: result?.success ? "completed" : "failed" as const,
          endTime: new Date().toISOString()
        }
        newCompleted.push(updatedTestData)
      })
      
      setCompletedTests(newCompleted)
      setRunningTests(new Map())
      
    } catch (error) {
      console.error('停止所有测试时发生错误:', error)
    }
  }

  // 旧的模拟数据更新逻辑已移除，现在使用真实的API数据

  const texts = {
    zh: {
      title: "烧机专区",
      description: "GPU烧机测试和实时监控",
      selectNodes: "选择空闲节点",
      searchPlaceholder: "搜索节点名称...",
      selectAll: "全选",
      deselectAll: "取消全选",
      selected: "已选择",
      nodes: "个节点",
      startTest: "开始烧机测试",
      stopTest: "停止测试",
      stopAll: "停止所有测试",
      runningTests: "正在运行的测试",
      completedTests: "已完成的测试",
      progress: "测试进度",
      activeUnits: "活跃单元",
      gflops: "计算吞吐量",
      errors: "错误计数",
      temperature: "温度",
      status: "状态",
      result: "结果",
      idle: "空闲",
      running: "运行中",
      completed: "已完成",
      failed: "已停止",
      noIdleNodes: "暂无空闲节点",
      noRunningTests: "暂无运行中的测试",
      noCompletedTests: "暂无已完成的测试",
      refreshNodes: "刷新节点",
      gpuCard: "GPU卡",
      gpuType: "GPU类型",
      gpuCount: "GPU数量",
      finalResult: "最终结果",
      testResult: "测试结果",
      prevPage: "上一页",
      nextPage: "下一页",
      page: "第",
      totalPages: "页，共",
      pagesUnit: "页",
      explanationTitle: "数据说明",
      progressExplanation: "测试进度 (Progress): 表示压力测试任务已完成的百分比，100%意味着测试完整执行完毕。",
      activeUnitsExplanation: "GPU计算单元活跃数量: 代表当前参与计算的单元数量。",
      gflopsExplanation: "瞬时计算吞吐量 (Gflop/s): 该GPU实时的浮点运算性能，可与GPU理论最大值比较评估性能。",
      errorsExplanation: "错误计数: 🚨 最关键字段，应始终显示为0。任何大于零的数字都表示计算错误，是不稳定的迹象。",
      temperatureExplanation: "GPU核心温度: 每个GPU的实时温度，是评估散热系统效能的关键指标。",
      itemsPerPage: "每页显示",
      items: "项",
      iconExplanation: "图标说明",
      cpuIcon: "计算单元活跃数量",
      zapIcon: "瞬时计算吞吐量 (Gflop/s)",
      alertIcon: "错误计数 (应为0)",
      thermometerIcon: "GPU核心温度 (°C)",
      // 参数设置相关
      parameterSettings: "参数设置",
      parameterSettingsDesc: "配置烧机测试参数",
      memorySettings: "显存设置",
      specifyMemory: "指定显存(MB)",
      memoryPercentage: "显存百分比(%)",
      testDuration: "测试时长",
      minutes: "分钟",
      pollingInterval: "轮询间隔",
      seconds: "秒",
      pollingEnabled: "启用轮询",
      pollingDisabled: "禁用轮询",
      parameterDescription: "参数说明",
      memoryParamDesc: "-m 参数：指定GPU显存大小，可以是固定MB值或百分比",
      durationParamDesc: "-d 参数：指定测试持续时间，单位为分钟",
      pollingParamDesc: "轮询间隔：前端自动查询烧机测试状态的频率，单位为秒",
      pollingEnableDesc: "启用/禁用：控制是否自动查询烧机测试状态",
      currentParameters: "当前参数",
      memoryParam: "显存参数",
      durationParam: "时长参数",
      pollingParam: "轮询参数",
    },
    en: {
      title: "Burn-in Test",
      description: "GPU burn-in testing and real-time monitoring",
      selectNodes: "Select Idle Nodes",
      searchPlaceholder: "Search node name...",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      selected: "Selected",
      nodes: "nodes",
      startTest: "Start Burn-in Test",
      stopTest: "Stop Test",
      stopAll: "Stop All Tests",
      runningTests: "Running Tests",
      completedTests: "Completed Tests",
      progress: "Test Progress",
      activeUnits: "Active Units",
      gflops: "Throughput",
      errors: "Errors",
      temperature: "Temperature",
      status: "Status",
      result: "Result",
      idle: "Idle",
      running: "Running",
      completed: "Completed",
      failed: "Stopped",
      noIdleNodes: "No idle nodes available",
      noRunningTests: "No running tests",
      noCompletedTests: "No completed tests",
      refreshNodes: "Refresh Nodes",
      gpuCard: "GPU Card",
      gpuType: "GPU Type",
      gpuCount: "GPU Count",
      finalResult: "Final Result",
      testResult: "Test Result",
      prevPage: "Previous",
      nextPage: "Next",
      page: "Page",
      totalPages: "of",
      pagesUnit: "",
      explanationTitle: "Data Explanation",
      progressExplanation: "Test Progress: Percentage of stress test task completed, 100% means test fully executed.",
      activeUnitsExplanation: "GPU Active Units: Number of computing units currently participating in calculations.",
      gflopsExplanation:
        "Instantaneous Throughput (Gflop/s): Real-time floating-point performance, compare with GPU theoretical maximum.",
      errorsExplanation:
        "Error Count: 🚨 Most critical field, should always show 0. Any non-zero value indicates computation errors.",
      temperatureExplanation:
        "GPU Core Temperature: Real-time temperature of each GPU, key indicator for cooling system efficiency.",
      itemsPerPage: "Items per page",
      items: "items",
      iconExplanation: "Icon Legend",
      cpuIcon: "Active Computing Units",
      zapIcon: "Instantaneous Throughput (Gflop/s)",
      alertIcon: "Error Count (should be 0)",
      thermometerIcon: "GPU Core Temperature (°C)",
      // 参数设置相关
      parameterSettings: "Parameter Settings",
      parameterSettingsDesc: "Configure Burn-in Test Parameters",
      memorySettings: "Memory Settings",
      specifyMemory: "Specify Memory (MB)",
      memoryPercentage: "Memory Percentage (%)",
      testDuration: "Test Duration",
      minutes: "minutes",
      pollingInterval: "Polling Interval",
      seconds: "seconds",
      pollingEnabled: "Enable Polling",
      pollingDisabled: "Disable Polling",
      parameterDescription: "Parameter Description",
      memoryParamDesc: "-m parameter: Specify GPU memory size, can be fixed MB value or percentage",
      durationParamDesc: "-d parameter: Specify test duration in minutes",
      pollingParamDesc: "Polling interval: Frequency for frontend to automatically query burn-in test status, in seconds",
      pollingEnableDesc: "Enable/Disable: Control whether to automatically query burn-in test status",
      currentParameters: "Current Parameters",
      memoryParam: "Memory Parameter",
      durationParam: "Duration Parameter",
      pollingParam: "Polling Parameter",
    },
  }

  const currentTexts = texts[language]

  // 初始化时刷新节点
  useEffect(() => {
    refreshIdleNodes()
  }, [])

  // 实时获取烧机测试数据
  useEffect(() => {
    if (runningTests.size > 0 && pollingEnabled) {
      const interval = setInterval(async () => {
        try {
          // 获取所有运行中的测试状态
          for (const [nodeId, testData] of runningTests.entries()) {
            if (testData.jobId) {
              const response = await fetch(`${API_BASE_URL}/api/burnin/jobs/${testData.jobId}`)
              if (response.ok) {
                const result = await response.json()
                if (result.success && result.job) {
                  // 更新测试数据
                  const newTests = new Map(runningTests)
                  const updatedTestData = {
                    ...testData,
                    progress: result.job.progress || 0,
                    gpus: result.job.gpus || [],
                    status: result.job.status === 'completed' ? 'completed' : 'running'
                  }
                  
                  if (updatedTestData.status === 'completed') {
                    // 测试完成，移动到已完成列表
                    setCompletedTests(prev => [...prev, { ...updatedTestData, endTime: new Date().toISOString() }])
                    newTests.delete(nodeId)
                  } else {
                    newTests.set(nodeId, updatedTestData)
                  }
                  
                  setRunningTests(newTests)
                }
              }
            }
          }
        } catch (error) {
          console.error('获取烧机测试状态失败:', error)
        }
      }, parseInt(pollingInterval) * 1000) // 使用可配置的轮询间隔

      return () => clearInterval(interval)
    }
  }, [runningTests, pollingInterval, pollingEnabled])

  return (
    <div className="space-y-8 text-foreground">
      {/* 页面标题 */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent animate-slide-in">
          {currentTexts.title}
        </h1>
        <p className="text-lg text-muted-foreground font-mono animate-slide-in">
          {currentTexts.description}
        </p>
        <div className="w-24 h-1 bg-gradient-primary mx-auto rounded-full animate-glow" />
      </div>

      {/* 图标说明卡片 */}
      <Card className="tech-card bg-gradient-to-br from-tech-blue/10 to-tech-purple/10 border-tech-blue/30 shadow-glow">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <div className="p-2 rounded-lg bg-tech-blue/20">
              <Info className="w-5 h-5 text-tech-blue" />
            </div>
            <span className="bg-gradient-primary bg-clip-text text-transparent">
              {currentTexts.iconExplanation}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 backdrop-blur-sm hover:bg-secondary/50 transition-all duration-300">
              <div className="p-2 rounded-lg bg-tech-blue/20">
                <Cpu className="w-4 h-4 text-tech-blue" />
              </div>
              <span className="text-foreground font-medium">{currentTexts.cpuIcon}</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 backdrop-blur-sm hover:bg-secondary/50 transition-all duration-300">
              <div className="p-2 rounded-lg bg-tech-yellow/20">
                <Zap className="w-4 h-4 text-tech-yellow" />
              </div>
              <span className="text-foreground font-medium">{currentTexts.zapIcon}</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 backdrop-blur-sm hover:bg-secondary/50 transition-all duration-300">
              <div className="p-2 rounded-lg bg-tech-red/20">
                <AlertTriangle className="w-4 h-4 text-tech-red" />
              </div>
              <span className="text-foreground font-medium">{currentTexts.alertIcon}</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 backdrop-blur-sm hover:bg-secondary/50 transition-all duration-300">
              <div className="p-2 rounded-lg bg-tech-orange/20">
                <Thermometer className="w-4 h-4 text-tech-orange" />
              </div>
              <span className="text-foreground font-medium">
                {currentTexts.thermometerIcon}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 数据说明卡片 */}
      <Card className="tech-card bg-gradient-to-br from-tech-cyan/10 to-tech-blue/10 border-tech-cyan/30 shadow-glow">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <div className="p-2 rounded-lg bg-tech-cyan/20">
              <Info className="w-5 h-5 text-tech-cyan" />
            </div>
            <span className="bg-gradient-secondary bg-clip-text text-transparent">
              {currentTexts.explanationTitle}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <p className="text-foreground">
                <strong className="text-tech-blue font-semibold">{currentTexts.progress}:</strong>{" "}
                <span className="text-muted-foreground">{currentTexts.progressExplanation}</span>
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <p className="text-foreground">
                <strong className="text-tech-green font-semibold">
                  {currentTexts.activeUnits}:
                </strong>{" "}
                <span className="text-muted-foreground">{currentTexts.activeUnitsExplanation}</span>
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <p className="text-foreground">
                <strong className="text-tech-yellow font-semibold">{currentTexts.gflops}:</strong>{" "}
                <span className="text-muted-foreground">{currentTexts.gflopsExplanation}</span>
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <p className="text-foreground">
                <strong className="text-tech-red font-semibold">{currentTexts.errors}:</strong>{" "}
                <span className="text-muted-foreground">{currentTexts.errorsExplanation}</span>
              </p>
            </div>
            <div className="md:col-span-2 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <p className="text-foreground">
                <strong className="text-tech-orange font-semibold">
                  {currentTexts.temperature}:
                </strong>{" "}
                <span className="text-muted-foreground">{currentTexts.temperatureExplanation}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 参数设置卡片 */}
      <Card className="tech-card bg-gradient-to-br from-tech-purple/10 to-tech-pink/10 border-tech-purple/30 shadow-glow">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <div className="p-2 rounded-lg bg-tech-purple/20">
              <Settings className="w-5 h-5 text-tech-purple" />
            </div>
            <span className="bg-gradient-to-r from-tech-purple to-tech-pink bg-clip-text text-transparent">
              {currentTexts.parameterSettings}
            </span>
          </CardTitle>
          <CardDescription className="text-muted-foreground font-mono">
            {currentTexts.parameterSettingsDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 主要参数设置 - 横向布局 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 显存设置 */}
            <div className="space-y-4 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <h4 className="font-semibold text-sm text-tech-blue flex items-center gap-2">
                <div className="w-2 h-2 bg-tech-blue rounded-full animate-pulse" />
                {currentTexts.memorySettings}
              </h4>
              <div className="space-y-3">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="memory-fixed"
                      name="memoryType"
                      value="fixed"
                      checked={memoryType === "fixed"}
                      onChange={(e) => setMemoryType(e.target.value as "fixed" | "percentage")}
                      className="w-4 h-4 text-tech-blue accent-tech-blue"
                    />
                    <label htmlFor="memory-fixed" className="text-xs text-foreground font-medium">
                      {currentTexts.specifyMemory}
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="memory-percentage"
                      name="memoryType"
                      value="percentage"
                      checked={memoryType === "percentage"}
                      onChange={(e) => setMemoryType(e.target.value as "fixed" | "percentage")}
                      className="w-4 h-4 text-tech-blue accent-tech-blue"
                    />
                    <label htmlFor="memory-percentage" className="text-xs text-foreground font-medium">
                      {currentTexts.memoryPercentage}
                    </label>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Input
                    type="number"
                    value={memoryValue}
                    onChange={(e) => setMemoryValue(e.target.value)}
                    className="tech-input w-24 h-9 text-sm font-mono"
                    min="1"
                    max={memoryType === "percentage" ? "100" : "100000"}
                  />
                  <span className="text-xs text-tech-blue font-mono font-semibold">
                    {memoryType === "percentage" ? "%" : "MB"}
                  </span>
                </div>
              </div>
            </div>

            {/* 测试时长 */}
            <div className="space-y-4 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <h4 className="font-semibold text-sm text-tech-green flex items-center gap-2">
                <div className="w-2 h-2 bg-tech-green rounded-full animate-pulse" />
                {currentTexts.testDuration}
              </h4>
              <div className="flex items-center space-x-3">
                <Input
                  type="number"
                  value={testDuration}
                  onChange={(e) => setTestDuration(e.target.value)}
                  className="tech-input w-24 h-9 text-sm font-mono"
                  min="1"
                  max="1440"
                />
                <span className="text-xs text-tech-green font-mono font-semibold">
                  {currentTexts.minutes}
                </span>
              </div>
            </div>

            {/* 轮询控制 */}
            <div className="space-y-4 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <h4 className="font-semibold text-sm text-tech-orange flex items-center gap-2">
                <div className="w-2 h-2 bg-tech-orange rounded-full animate-pulse" />
                {currentTexts.pollingInterval}
              </h4>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="polling-enabled"
                    checked={pollingEnabled}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true
                      setPollingEnabled(enabled)
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('burnin-polling-enabled', enabled.toString())
                      }
                    }}
                    className="w-4 h-4 text-tech-orange accent-tech-orange"
                  />
                  <label 
                    htmlFor="polling-enabled" 
                    className="text-xs font-semibold text-foreground"
                  >
                    {pollingEnabled ? currentTexts.pollingEnabled : currentTexts.pollingDisabled}
                  </label>
                </div>
                {pollingEnabled && (
                  <div className="flex items-center space-x-3">
                    <Input
                      type="number"
                      value={pollingInterval}
                      onChange={(e) => {
                        const value = e.target.value
                        setPollingInterval(value)
                        if (typeof window !== 'undefined') {
                          localStorage.setItem('burnin-polling-interval', value)
                        }
                      }}
                      className="tech-input w-20 h-9 text-sm font-mono"
                      min="1"
                      max="60"
                    />
                    <span className="text-xs text-tech-orange font-mono font-semibold">
                      {currentTexts.seconds}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 当前参数显示 - 科技感布局 */}
          <div className="p-4 rounded-lg bg-gradient-to-r from-tech-blue/10 to-tech-purple/10 border border-tech-blue/30 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-tech-blue flex items-center gap-2">
                <div className="w-2 h-2 bg-tech-blue rounded-full animate-pulse" />
                {currentTexts.currentParameters}:
              </span>
              <div className="text-sm font-mono text-foreground space-x-4">
                <span className="px-3 py-1 rounded-lg bg-tech-blue/20 text-tech-blue font-semibold">
                  -m {memoryValue}{memoryType === "percentage" ? "%" : "MB"}
                </span>
                <span className="px-3 py-1 rounded-lg bg-tech-green/20 text-tech-green font-semibold">
                  -d {testDuration}min
                </span>
                <span className="px-3 py-1 rounded-lg bg-tech-orange/20 text-tech-orange font-semibold">
                  {currentTexts.pollingParam}: {pollingEnabled ? `${pollingInterval}s` : 'disabled'}
                </span>
              </div>
            </div>
          </div>

          {/* 参数说明 - 科技感折叠式 */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-tech-cyan hover:text-tech-blue transition-colors duration-300 flex items-center gap-2 p-3 rounded-lg bg-secondary/20 hover:bg-secondary/40">
              <div className="w-2 h-2 bg-tech-cyan rounded-full" />
              {currentTexts.parameterDescription} 
              <span className="transform group-open:rotate-180 transition-transform duration-300">▼</span>
            </summary>
            <div className="mt-3 p-4 rounded-lg bg-secondary/10 border border-border/30 space-y-2 text-xs font-mono">
              <p className="text-tech-blue">• {currentTexts.memoryParamDesc}</p>
              <p className="text-tech-green">• {currentTexts.durationParamDesc}</p>
              <p className="text-tech-orange">• {currentTexts.pollingParamDesc}</p>
              <p className="text-tech-purple">• {currentTexts.pollingEnableDesc}</p>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* 选择空闲节点卡片 */}
      <Card className="tech-card bg-gradient-to-br from-tech-green/10 to-tech-blue/10 border-tech-green/30 shadow-glow">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="text-lg font-bold bg-gradient-accent bg-clip-text text-transparent">
              {currentTexts.selectNodes}
            </span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshIdleNodes}
              disabled={refreshDisabled || loading}
              className="tech-button border-tech-green/50 hover:bg-tech-green/20 hover:border-tech-green"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {refreshDisabled ? `${countdown}s` : currentTexts.refreshNodes}
            </Button>
          </CardTitle>
          <CardDescription className="text-muted-foreground font-mono">
            {currentTexts.selected} {selectedNodes.length} {currentTexts.nodes}
            {refreshError && (
              <div className="mt-2 text-tech-red text-sm font-semibold p-2 rounded-lg bg-tech-red/10 border border-tech-red/30">
                {refreshError}
              </div>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-tech-blue" />
              <Input
                placeholder={currentTexts.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="tech-input pl-10"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm whitespace-nowrap text-tech-cyan font-semibold">
                {currentTexts.itemsPerPage}:
              </span>
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(value) => {
                  setItemsPerPage(Number.parseInt(value))
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="tech-input w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="tech-card">
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="15">15</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSelectAll}
                className="tech-button border-tech-blue/50 hover:bg-tech-blue/20 hover:border-tech-blue"
              >
                {selectedNodes.length === currentNodes.length ? currentTexts.deselectAll : currentTexts.selectAll}
              </Button>
              <Button
                onClick={startBurnInTest}
                disabled={selectedNodes.length === 0 || loading}
                className="tech-button bg-gradient-danger hover:shadow-glow-red disabled:opacity-50"
              >
                <Play className={`w-4 h-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
                {loading ? '启动中...' : currentTexts.startTest}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentNodes.map((node) => (
              <Card
                key={node.nodeId}
                className={`tech-card cursor-pointer transition-all duration-300 group ${
                  selectedNodes.includes(node.nodeId)
                    ? "bg-gradient-to-br from-tech-orange/20 to-tech-red/20 border-tech-orange shadow-glow-red"
                    : "bg-gradient-to-br from-secondary/30 to-secondary/10 border-border/50 hover:border-tech-blue/50 hover:shadow-glow"
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <Checkbox
                          checked={selectedNodes.includes(node.nodeId)}
                          onCheckedChange={(checked) => handleNodeSelection(node.nodeId, checked as boolean)}
                          className="w-4 h-4 text-tech-blue accent-tech-blue"
                        />
                        <h3 className="font-bold text-lg text-foreground group-hover:text-tech-blue transition-colors">
                          {node.nodeName}
                        </h3>
                      </div>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center p-2 rounded-lg bg-secondary/20">
                          <span className="text-tech-cyan font-semibold">{currentTexts.gpuType}:</span>
                          <span className="text-foreground font-mono font-bold">{node.gpuType}</span>
                        </div>
                        <div className="flex justify-between items-center p-2 rounded-lg bg-secondary/20">
                          <span className="text-tech-green font-semibold">{currentTexts.gpuCount}:</span>
                          <span className="text-foreground font-mono font-bold">{node.gpuCount}</span>
                        </div>
                        <div className="flex justify-between items-center p-2 rounded-lg bg-secondary/20">
                          <span className="text-tech-purple font-semibold">
                            {currentTexts.status}:
                          </span>
                          <Badge className="status-idle px-3 py-1 rounded-full text-xs font-semibold">
                            {currentTexts.idle}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="tech-button border-tech-blue/50 hover:bg-tech-blue/20 hover:border-tech-blue disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                {currentTexts.prevPage}
              </Button>
              <div className="flex items-center gap-4">
                <span className="text-sm text-tech-cyan font-semibold">
                  {currentTexts.page} {currentPage} {currentTexts.totalPages} {totalPages} {currentTexts.pagesUnit}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  ({startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredNodes.length)} / {filteredNodes.length}{" "}
                  {currentTexts.items})
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="tech-button border-tech-blue/50 hover:bg-tech-blue/20 hover:border-tech-blue disabled:opacity-50"
              >
                {currentTexts.nextPage}
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {runningTests.size > 0 && (
        <Card className="tech-card bg-gradient-to-br from-tech-orange/10 to-tech-red/10 border-tech-orange/30 shadow-glow-red">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="text-lg font-bold bg-gradient-danger bg-clip-text text-transparent">
                {currentTexts.runningTests}
              </span>
              <div className="flex items-center space-x-3">
                {!pollingEnabled && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={refreshBurnInStatus}
                    className="tech-button border-tech-blue/50 hover:bg-tech-blue/20 hover:border-tech-blue"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {currentTexts.refreshNodes}
                  </Button>
                )}
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={stopAllTests}
                  className="tech-button bg-gradient-danger hover:shadow-glow-red"
                >
                  <Square className="w-4 h-4 mr-2" />
                  {currentTexts.stopAll}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            {Array.from(runningTests.entries()).map(([nodeId, testData]) => (
              <div key={nodeId} className="space-y-6 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-xl text-foreground mb-2">
                      {testData.nodeName}
                    </h3>
                    <div className="flex gap-6 text-sm">
                      <span className="flex items-center gap-2 text-tech-blue font-semibold">
                        <Activity className="w-4 h-4" />
                        {currentTexts.progress}: {testData.progress.toFixed(1)}%
                      </span>
                      <span className="flex items-center gap-2 text-tech-cyan font-semibold">
                        <Settings className="w-4 h-4" />
                        -m {memoryValue}{memoryType === "percentage" ? "%" : "MB"} -d {testDuration}min
                      </span>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => stopBurnInTest(nodeId)}
                    className="tech-button border-tech-red/50 hover:bg-tech-red/20 hover:border-tech-red"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    {currentTexts.stopTest}
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {testData.gpus.map((gpu) => (
                    <Card key={gpu.id} className="tech-card bg-gradient-to-br from-secondary/40 to-secondary/20 border-border/50 hover:border-tech-blue/50 hover:shadow-glow transition-all duration-300">
                      <CardContent className="p-4">
                        <div className="text-center">
                          <div className="font-bold mb-3 text-tech-blue text-sm">
                            {currentTexts.gpuCard} {gpu.id}
                          </div>
                          <div className="space-y-3 text-xs">
                            <div className="flex items-center justify-between p-2 rounded-lg bg-tech-blue/10">
                              <Cpu className="w-3 h-3 text-tech-blue" />
                              <span className="text-foreground font-mono font-bold">
                                {gpu.activeUnits}
                              </span>
                            </div>
                            <div className="flex items-center justify-between p-2 rounded-lg bg-tech-yellow/10">
                              <Zap className="w-3 h-3 text-tech-yellow" />
                              <span className="text-foreground font-mono font-bold">
                                {(gpu.gflops / 1000).toFixed(0)} Gflop/s
                              </span>
                            </div>
                            <div
                              className={`flex items-center justify-between p-2 rounded-lg ${
                                gpu.errors > 0 
                                  ? "bg-tech-red/20 text-tech-red font-bold" 
                                  : "bg-tech-green/10 text-tech-green"
                              }`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              <span className="font-mono font-bold">{gpu.errors}</span>
                            </div>
                            <div className="flex items-center justify-between p-2 rounded-lg bg-tech-orange/10">
                              <Thermometer className="w-3 h-3 text-tech-orange" />
                              <span className="text-foreground font-mono font-bold">
                                {gpu.temperature}°C
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {completedTests.length > 0 && (
        <Card className="tech-card bg-gradient-to-br from-tech-green/10 to-tech-blue/10 border-tech-green/30 shadow-glow-green">
          <CardHeader>
            <CardTitle className="text-lg font-bold bg-gradient-accent bg-clip-text text-transparent">
              {currentTexts.completedTests}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {completedTests.map((testData, index) => (
              <div key={index} className="space-y-4 p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-xl text-foreground mb-2">
                      {testData.nodeName}
                    </h3>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      {currentTexts.status}:
                      <Badge 
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          testData.status === "completed" 
                            ? "status-running" 
                            : "status-error"
                        }`}
                      >
                        {testData.status === "completed" ? currentTexts.completed : currentTexts.failed}
                      </Badge>
                    </p>
                  </div>
                </div>

                {testData.finalResult && (
                  <div>
                    <h4 className="font-bold mb-3 text-tech-cyan flex items-center gap-2">
                      <div className="w-2 h-2 bg-tech-cyan rounded-full animate-pulse" />
                      {currentTexts.finalResult}:
                    </h4>
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                      {Object.entries(testData.finalResult).map(([gpuId, result]) => (
                        <div
                          key={gpuId}
                          className={`flex items-center justify-center p-3 rounded-lg border-2 transition-all duration-300 ${
                            result === "OK" 
                              ? "border-tech-green bg-tech-green/10 hover:shadow-glow-green" 
                              : "border-tech-red bg-tech-red/10 hover:shadow-glow-red"
                          }`}
                        >
                          <span className="text-xs mr-2 text-tech-cyan font-mono font-semibold">
                            GPU {gpuId}:
                          </span>
                          {result === "OK" ? (
                            <CheckCircle className="w-4 h-4 text-tech-green" />
                          ) : (
                            <XCircle className="w-4 h-4 text-tech-red" />
                          )}
                          <span className={`text-xs ml-2 font-mono font-bold ${
                            result === "OK" ? "text-tech-green" : "text-tech-red"
                          }`}>
                            {result}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {runningTests.size === 0 && completedTests.length === 0 && (
        <Card className="tech-card bg-gradient-to-br from-secondary/20 to-secondary/10 border-border/50">
          <CardContent className="text-center py-16">
            <div className="relative">
              <Monitor className="w-16 h-16 mx-auto mb-6 text-tech-blue animate-float" />
              <div className="absolute inset-0 w-16 h-16 mx-auto bg-tech-blue/20 rounded-full animate-pulse-slow" />
            </div>
            <p className="text-muted-foreground text-lg font-mono">
              Select nodes and start burn-in test
            </p>
            <div className="mt-4 w-32 h-1 bg-gradient-primary mx-auto rounded-full animate-glow" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
