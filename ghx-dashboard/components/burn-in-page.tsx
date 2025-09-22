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
  theme: "light" | "dark"
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

export default function BurnInPage({ theme, language, t }: BurnInPageProps) {
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
    <div className={`space-y-6 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
      <div>
        <h1 className="text-3xl font-bold">{currentTexts.title}</h1>
        <p className={`mt-2 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{currentTexts.description}</p>
      </div>

      <Card className={theme === "dark" ? "bg-green-900/20 border-green-700" : "bg-green-50 border-green-200"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            {currentTexts.iconExplanation}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-500" />
              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>{currentTexts.cpuIcon}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>{currentTexts.zapIcon}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>{currentTexts.alertIcon}</span>
            </div>
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-orange-500" />
              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                {currentTexts.thermometerIcon}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={theme === "dark" ? "bg-blue-900/20 border-blue-700" : "bg-blue-50 border-blue-200"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            {currentTexts.explanationTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                <strong className={theme === "dark" ? "text-white" : "text-gray-900"}>{currentTexts.progress}:</strong>{" "}
                {currentTexts.progressExplanation}
              </p>
            </div>
            <div>
              <p className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                <strong className={theme === "dark" ? "text-white" : "text-gray-900"}>
                  {currentTexts.activeUnits}:
                </strong>{" "}
                {currentTexts.activeUnitsExplanation}
              </p>
            </div>
            <div>
              <p className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                <strong className={theme === "dark" ? "text-white" : "text-gray-900"}>{currentTexts.gflops}:</strong>{" "}
                {currentTexts.gflopsExplanation}
              </p>
            </div>
            <div>
              <p className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                <strong className={theme === "dark" ? "text-white" : "text-gray-900"}>{currentTexts.errors}:</strong>{" "}
                {currentTexts.errorsExplanation}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                <strong className={theme === "dark" ? "text-white" : "text-gray-900"}>
                  {currentTexts.temperature}:
                </strong>{" "}
                {currentTexts.temperatureExplanation}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 参数设置卡片 */}
      <Card className={theme === "dark" ? "bg-pink-900/20 border-pink-700" : "bg-pink-50 border-pink-200"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {currentTexts.parameterSettings}
          </CardTitle>
          <CardDescription>{currentTexts.parameterSettingsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 主要参数设置 - 横向布局 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 显存设置 */}
            <div className="space-y-3">
              <h4 className={`font-medium text-sm ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                {currentTexts.memorySettings}
              </h4>
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1">
                    <input
                      type="radio"
                      id="memory-fixed"
                      name="memoryType"
                      value="fixed"
                      checked={memoryType === "fixed"}
                      onChange={(e) => setMemoryType(e.target.value as "fixed" | "percentage")}
                      className="w-3 h-3 text-blue-600"
                    />
                    <label htmlFor="memory-fixed" className={`text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                      {currentTexts.specifyMemory}
                    </label>
                  </div>
                  <div className="flex items-center space-x-1">
                    <input
                      type="radio"
                      id="memory-percentage"
                      name="memoryType"
                      value="percentage"
                      checked={memoryType === "percentage"}
                      onChange={(e) => setMemoryType(e.target.value as "fixed" | "percentage")}
                      className="w-3 h-3 text-blue-600"
                    />
                    <label htmlFor="memory-percentage" className={`text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                      {currentTexts.memoryPercentage}
                    </label>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    value={memoryValue}
                    onChange={(e) => setMemoryValue(e.target.value)}
                    className="w-20 h-8 text-sm"
                    min="1"
                    max={memoryType === "percentage" ? "100" : "100000"}
                  />
                  <span className={`text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    {memoryType === "percentage" ? "%" : "MB"}
                  </span>
                </div>
              </div>
            </div>

            {/* 测试时长 */}
            <div className="space-y-3">
              <h4 className={`font-medium text-sm ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                {currentTexts.testDuration}
              </h4>
              <div className="flex items-center space-x-2">
                <Input
                  type="number"
                  value={testDuration}
                  onChange={(e) => setTestDuration(e.target.value)}
                  className="w-20 h-8 text-sm"
                  min="1"
                  max="1440"
                />
                <span className={`text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                  {currentTexts.minutes}
                </span>
              </div>
            </div>

            {/* 轮询控制 */}
            <div className="space-y-3">
              <h4 className={`font-medium text-sm ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                {currentTexts.pollingInterval}
              </h4>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
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
                    className="w-3 h-3"
                  />
                  <label 
                    htmlFor="polling-enabled" 
                    className={`text-xs font-medium ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}
                  >
                    {pollingEnabled ? currentTexts.pollingEnabled : currentTexts.pollingDisabled}
                  </label>
                </div>
                {pollingEnabled && (
                  <div className="flex items-center space-x-2">
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
                      className="w-16 h-8 text-sm"
                      min="1"
                      max="60"
                    />
                    <span className={`text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                      {currentTexts.seconds}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 当前参数显示 - 紧凑布局 */}
          <div className={`p-3 rounded-lg ${theme === "dark" ? "bg-gray-700/50" : "bg-gray-100/50"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                {currentTexts.currentParameters}:
              </span>
              <div className={`text-sm font-mono ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                <span className="mr-4">-m {memoryValue}{memoryType === "percentage" ? "%" : "MB"}</span>
                <span className="mr-4">-d {testDuration}min</span>
                <span>{currentTexts.pollingParam}: {pollingEnabled ? `${pollingInterval}s` : 'disabled'}</span>
              </div>
            </div>
          </div>

          {/* 参数说明 - 折叠式 */}
          <details className={`group ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
            <summary className={`cursor-pointer text-sm font-medium ${theme === "dark" ? "text-gray-200" : "text-gray-800"} hover:underline`}>
              {currentTexts.parameterDescription} ▼
            </summary>
            <div className="mt-2 text-xs space-y-1 pl-4">
              <p>• {currentTexts.memoryParamDesc}</p>
              <p>• {currentTexts.durationParamDesc}</p>
              <p>• {currentTexts.pollingParamDesc}</p>
              <p>• {currentTexts.pollingEnableDesc}</p>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className={theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{currentTexts.selectNodes}</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshIdleNodes}
              disabled={refreshDisabled || loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {refreshDisabled ? `${countdown}s` : currentTexts.refreshNodes}
            </Button>
          </CardTitle>
          <CardDescription>
            {currentTexts.selected} {selectedNodes.length} {currentTexts.nodes}
            {refreshError && (
              <div className="mt-2 text-red-500 text-sm">
                {refreshError}
              </div>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder={currentTexts.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm whitespace-nowrap ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                {currentTexts.itemsPerPage}:
              </span>
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(value) => {
                  setItemsPerPage(Number.parseInt(value))
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="15">15</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {selectedNodes.length === currentNodes.length ? currentTexts.deselectAll : currentTexts.selectAll}
              </Button>
              <Button
                onClick={startBurnInTest}
                disabled={selectedNodes.length === 0 || loading}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Play className={`w-4 h-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
                {loading ? '启动中...' : currentTexts.startTest}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentNodes.map((node) => (
              <Card
                key={node.nodeId}
                className={`cursor-pointer transition-all ${
                  selectedNodes.includes(node.nodeId)
                    ? theme === "dark"
                      ? "bg-orange-900/30 border-orange-500"
                      : "bg-orange-50 border-orange-300"
                    : theme === "dark"
                      ? "bg-gray-700 border-gray-600 hover:bg-gray-600"
                      : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox
                          checked={selectedNodes.includes(node.nodeId)}
                          onCheckedChange={(checked) => handleNodeSelection(node.nodeId, checked as boolean)}
                        />
                        <h3 className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                          {node.nodeName}
                        </h3>
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>{currentTexts.gpuType}:</span>
                          <span className={theme === "dark" ? "text-gray-100" : "text-gray-900"}>{node.gpuType}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>{currentTexts.gpuCount}:</span>
                          <span className={theme === "dark" ? "text-gray-100" : "text-gray-900"}>{node.gpuCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
                            {currentTexts.status}:
                          </span>
                          <Badge
                            variant="secondary"
                            className={theme === "dark" ? "bg-green-800 text-green-200" : "bg-green-100 text-green-800"}
                          >
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
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                {currentTexts.prevPage}
              </Button>
              <div className="flex items-center gap-4">
                <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                  {currentTexts.page} {currentPage} {currentTexts.totalPages} {totalPages} {currentTexts.pagesUnit}
                </span>
                <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                  ({startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredNodes.length)} / {filteredNodes.length}{" "}
                  {currentTexts.items})
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                {currentTexts.nextPage}
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {runningTests.size > 0 && (
        <Card className={theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{currentTexts.runningTests}</span>
              <div className="flex items-center space-x-2">
                {!pollingEnabled && (
                  <Button variant="outline" size="sm" onClick={refreshBurnInStatus}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {currentTexts.refreshNodes}
                  </Button>
                )}
                <Button variant="destructive" size="sm" onClick={stopAllTests}>
                  <Square className="w-4 h-4 mr-2" />
                  {currentTexts.stopAll}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {Array.from(runningTests.entries()).map(([nodeId, testData]) => (
              <div key={nodeId} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {testData.nodeName}
                    </h3>
                    <div className={`flex gap-4 text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                      <span className="flex items-center gap-1">
                        <Activity className="w-4 h-4" />
                        {currentTexts.progress}: {testData.progress.toFixed(1)}%
                      </span>
                      <span className="flex items-center gap-1">
                        <Settings className="w-4 h-4" />
                        -m {memoryValue}{memoryType === "percentage" ? "%" : "MB"} -d {testDuration}min
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => stopBurnInTest(nodeId)}>
                    <Square className="w-4 h-4 mr-2" />
                    {currentTexts.stopTest}
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {testData.gpus.map((gpu) => (
                    <Card key={gpu.id} className={theme === "dark" ? "bg-gray-700" : "bg-gray-50"}>
                      <CardContent className="p-3">
                        <div className="text-center">
                          <div className={`font-medium mb-2 ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                            {currentTexts.gpuCard} {gpu.id}
                          </div>
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <Cpu className="w-3 h-3 text-blue-500" />
                              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                                {gpu.activeUnits}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <Zap className="w-3 h-3 text-yellow-500" />
                              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
                                {(gpu.gflops / 1000).toFixed(0)} Gflop/s
                              </span>
                            </div>
                            <div
                              className={`flex items-center justify-between ${gpu.errors > 0 ? "text-red-500 font-bold" : "text-green-500"}`}
                            >
                              <AlertTriangle className="w-3 h-3 text-red-500" />
                              <span>{gpu.errors}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <Thermometer className="w-3 h-3 text-orange-500" />
                              <span className={theme === "dark" ? "text-gray-200" : "text-gray-700"}>
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
        <Card className={theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}>
          <CardHeader>
            <CardTitle>{currentTexts.completedTests}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {completedTests.map((testData, index) => (
              <div key={index} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {testData.nodeName}
                    </h3>
                    <p className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                      {currentTexts.status}:
                      <Badge variant={testData.status === "completed" ? "default" : "destructive"} className="ml-2">
                        {testData.status === "completed" ? currentTexts.completed : currentTexts.failed}
                      </Badge>
                    </p>
                  </div>
                </div>

                {testData.finalResult && (
                  <div>
                    <h4 className={`font-medium mb-2 ${theme === "dark" ? "text-gray-200" : "text-gray-800"}`}>
                      {currentTexts.finalResult}:
                    </h4>
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                      {Object.entries(testData.finalResult).map(([gpuId, result]) => (
                        <div
                          key={gpuId}
                          className={`flex items-center justify-center p-2 rounded border ${theme === "dark" ? "border-gray-600 bg-gray-700" : "border-gray-200 bg-gray-50"}`}
                        >
                          <span className={`text-xs mr-1 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                            GPU {gpuId}:
                          </span>
                          {result === "OK" ? (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                          <span className={`text-xs ml-1 ${theme === "dark" ? "text-gray-200" : "text-gray-700"}`}>
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
        <Card className={theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}>
          <CardContent className="text-center py-12">
            <Monitor className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className={`${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
              Select nodes and start burn-in test
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
