"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { XCircle, Download } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SummaryCards } from "@/components/summary-cards"
import { NodeDetailsTable } from "@/components/node-details-table"
import { Badge } from "@/components/ui/badge"

interface DashboardContentProps {
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

// 示例数据 - 作为fallback使用
const mockData = [
  {
    hostname: "gpu-node-001",
    gpuType: "H200",
    bandwidthTest: "54.9 GB/s",
    p2pBandwidthLatencyTest: "736.40 GB/s",
    ncclTests: "150.946 GB/s",
    dcgmDiag: "Pass",
    ibCheck: "Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试完成: 54.9 GB/s\n2024-01-15 02:00:10 - P2P测试完成: 736.40 GB/s\n2024-01-15 02:00:15 - NCCL测试完成: 150.946 GB/s\n2024-01-15 02:00:20 - DCGM诊断完成: Pass\n2024-01-15 02:00:25 - IB检查完成: Pass\n2024-01-15 02:00:30 - 所有检查项目完成，结果: Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
]

export function DashboardContent({ theme, language, t }: DashboardContentProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState({
    totalNodes: 0,
    passedNodes: 0,
    failedNodes: 0,
    lastUpdated: null,
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // API地址，统一使用一个服务
  const API_BASE_URL = typeof window !== "undefined" && (window as any).NEXT_PUBLIC_API_URL ? (window as any).NEXT_PUBLIC_API_URL : "http://localhost:5000"

  // 统一数据格式处理（移除复杂的转换逻辑）
  const getDisplayData = (result: any) => {
    if (!result) return null
    
    // 直接使用统一的字段结构
    return {
      nodeName: result.nodeName || result.hostname || 'Unknown',
      gpuType: result.gpuType || 'Unknown',
      bandwidthTest: result.bandwidthTest || 'N/A',
      p2pBandwidthLatencyTest: result.p2pBandwidthLatencyTest || 'N/A',
      ncclTests: result.ncclTests || 'N/A',
      dcgmDiag: result.dcgmDiag || 'N/A',
      ibCheck: result.ibCheck || 'N/A',
      timestamp: result.timestamp || result.executionTime || 'N/A',
      executionTime: result.executionTime || result.timestamp || 'N/A',
      executionLog: result.executionLog || 'N/A',
      // 保持原始数据用于状态判断
      originalResult: result
    }
  }

  // 获取GPU类型（兼容新旧两种格式）
  const getGpuType = (node: any) => {
    // 新格式：Job诊断结果
    if (node.gpuType) {
      return node.gpuType
    }
    
    // 旧格式：节点检查详情
    return node.gpuType || "Unknown"
  }

  // 获取节点名称（兼容新旧两种格式）
  const getNodeName = (node: any) => {
    // 新格式：Job诊断结果
    if (node.nodeName) {
      return node.nodeName
    }
    
    // 旧格式：节点检查详情
    return node.nodeName || "Unknown"
  }

  // 格式化时间
  const formatExecutionTime = (time: string) => {
    if (!time || time === 'N/A') return 'N/A'
    
    // 如果是执行时长格式（如 0:00:00.143453），跳过不显示
    if (time.includes(':') && time.includes('.') && time.startsWith('0:')) {
      return 'N/A' // 不显示执行时长
    }
    
    // 如果是ISO格式时间，转换为可读格式
    if (time.includes('T')) {
      try {
        const date = new Date(time)
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
      const date = new Date(time)
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
    
    return time
  }

  // 获取GPU检查数据
  const fetchData = async (refresh = false) => {
    try {
      setLoading(true)
      setError(null)
      const url = `${API_BASE_URL}/api/gpu-inspection${refresh ? '?refresh=true' : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const result = await response.json()
      if (result.error) {
        throw new Error(result.message || '获取数据失败')
      }
      const nodes = result.nodes || []
      setData(nodes)
      // 统计
      const uniqueNodes = nodes.reduce((acc: any[], node: any) => {
        const existingNode = acc.find(n => getNodeName(n) === getNodeName(node))
        if (!existingNode) acc.push(node)
        return acc
      }, [])
      const passedNodes = uniqueNodes.filter((node: any) => {
        const displayData = getDisplayData(node)
        return displayData ? displayData.dcgmDiag === "Pass" : false
      }).length
      const failedNodes = uniqueNodes.filter((node: any) => {
        const displayData = getDisplayData(node)
        return displayData ? displayData.dcgmDiag !== "Pass" : false
      }).length
      const lastUpdatedTime = refresh ? new Date().toISOString() : (result.summary?.lastUpdated || new Date().toISOString())
      setSummary({
        totalNodes: uniqueNodes.length,
        passedNodes,
        failedNodes,
        lastUpdated: lastUpdatedTime
      })
    } catch (err: any) {
      setError(err.message)
      // API失败，使用mock数据兜底
      setData(mockData)
      // 计算统计信息
      const uniqueNodes = [...new Set(mockData.map((node) => getNodeName(node)))]
      const passedNodes = uniqueNodes.filter((nodeName: string) => {
        const node = mockData.find((n) => getNodeName(n) === nodeName)
        if (!node) return false
        const displayData = getDisplayData(node)
        return displayData ? displayData.dcgmDiag === "Pass" : false
      }).length
      const failedNodes = uniqueNodes.filter((nodeName: string) => {
        const node = mockData.find((n) => getNodeName(n) === nodeName)
        if (!node) return false
        const displayData = getDisplayData(node)
        return displayData ? displayData.dcgmDiag !== "Pass" : false
      }).length
      setSummary({
        totalNodes: uniqueNodes.length,
        passedNodes: passedNodes,
        failedNodes: failedNodes,
        lastUpdated: new Date().toISOString()
      })
    } finally {
      setLoading(false)
    }
  }

  // 初始化和刷新
  useEffect(() => {
    fetchData()
    // 提取GPU类型
    const types = [...new Set(mockData.map((node) => node.gpuType))]
    setUsedGpuTypes(types)
  }, [])

  // 刷新按钮逻辑
  const handleRefresh = () => {
    fetchData(true)
  }

  // 排序相关状态
  const [sortField, setSortField] = useState<string>("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  // 执行日志相关状态
  const [selectedLog, setSelectedLog] = useState<any>(null)
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false)

  // 节点检查详情刷新限制
  const [inspectionLastRefresh, setInspectionLastRefresh] = useState<number>(0)
  const [inspectionRefreshDisabled, setInspectionRefreshDisabled] = useState(false)
  const [inspectionCountdown, setInspectionCountdown] = useState<number>(0)

  // 使用useRef管理倒计时定时器，避免闭包问题
  const inspectionCountdownRef = useRef<number | null>(null)

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

  const [usedGpuTypes, setUsedGpuTypes] = useState<string[]>([])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("asc")
    }
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1)
  }

  // ...existing code...

  const handleExportLogs = async () => {
    try {
      if (!data || data.length === 0) {
        alert('没有可导出的数据')
        return
      }

      // 动态导入JSZip
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      // 为每个节点创建日志文件
      data.forEach((log, index) => {
        const exportContent = `=== GPU节点检查执行日志 ===
主机名称: ${log.nodeName || log.hostname || 'N/A'}
GPU类型: ${log.gpuType || 'N/A'}
执行时间: ${formatExecutionTime(log.executionTime || log.timestamp || log.createdAt)}
检查结果: ${getFinalResult(log)}

=== 性能测试结果 ===
带宽测试: ${log.bandwidthTest || 'N/A'}
P2P带宽延迟测试: ${log.p2pBandwidthLatencyTest || 'N/A'}
NCCL测试: ${log.ncclTests || 'N/A'}
DCGM诊断: ${log.dcgmDiag || 'N/A'}
IB检查: ${log.ibCheck || 'N/A'}

=== 执行日志详情 ===
${log.executionLog || '无日志'}

=== 导出信息 ===
导出时间: ${new Date().toLocaleString('zh-CN')}
导出来源: GPU节点检查系统`

        // 添加到ZIP文件
        const fileName = `gpu_check_${log.nodeName || log.hostname || `node_${index}`}_${new Date().toISOString().split('T')[0]}.log`
        zip.file(fileName, exportContent)
      })

      // 生成ZIP文件
      const zipBlob = await zip.generateAsync({ type: 'blob' })

      // 创建下载链接
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `gpu_check_logs_${new Date().toISOString().split('T')[0]}.zip`
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // 清理URL对象
      URL.revokeObjectURL(url)
      
      console.log(`批量导出成功，共导出 ${data.length} 个节点日志`)
    } catch (error) {
      console.error('批量导出失败:', error)
      
      // 如果JSZip不可用，回退到单个文件导出
      if (error.message && error.message.includes('jszip')) {
        console.log('JSZip不可用，回退到单个文件导出')
        const allLogsContent = data.map((log, index) => {
          return `=== GPU节点检查执行日志 ${index + 1} ===
主机名称: ${log.nodeName || log.hostname || 'N/A'}
GPU类型: ${log.gpuType || 'N/A'}
执行时间: ${formatExecutionTime(log.executionTime || log.timestamp || log.createdAt)}
检查结果: ${getFinalResult(log)}

=== 性能测试结果 ===
带宽测试: ${log.bandwidthTest || 'N/A'}
P2P带宽延迟测试: ${log.p2pBandwidthLatencyTest || 'N/A'}
NCCL测试: ${log.ncclTests || 'N/A'}
DCGM诊断: ${log.dcgmDiag || 'N/A'}
IB检查: ${log.ibCheck || 'N/A'}

=== 执行日志详情 ===
${log.executionLog || '无日志'}

${'='.repeat(80)}`
        }).join('\n\n')

        const blob = new Blob([allLogsContent], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `gpu_check_all_logs_${new Date().toISOString().split('T')[0]}.txt`
        
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        
        console.log('回退到单个文件导出成功')
      } else {
        alert('批量导出失败: ' + error.message)
      }
    }
  }

  const handleViewLog = (log: any) => {
    setSelectedLog(log)
    setIsLogDialogOpen(true)
  }

  // 定义getFinalResult函数
  const getFinalResult = (item: any) => {
    const displayData = getDisplayData(item)
    if (!displayData) return 'Unknown'
    // 简单的状态判断逻辑
    if (displayData.dcgmDiag === 'Pass' && displayData.ibCheck === 'Pass') return 'Pass'
    if (displayData.dcgmDiag === 'Fail' || displayData.ibCheck === 'Fail') return 'Fail'
    return 'Unknown'
  }

  const handleExportLog = (log: any) => {
    try {
      if (!log) {
        console.error('无效的日志对象')
        return
      }

      // 准备导出内容 - 使用纯文本格式，提升可读性
      const exportContent = `=== GPU节点检查执行日志 ===
主机名称: ${log.nodeName || log.hostname || 'N/A'}
GPU类型: ${log.gpuType || 'N/A'}
执行时间: ${formatExecutionTime(log.executionTime || log.timestamp || log.createdAt)}
检查结果: ${getFinalResult(log)}

=== 性能测试结果 ===
带宽测试: ${log.bandwidthTest || 'N/A'}
P2P带宽延迟测试: ${log.p2pBandwidthLatencyTest || 'N/A'}
NCCL测试: ${log.ncclTests || 'N/A'}
DCGM诊断: ${log.dcgmDiag || 'N/A'}
IB检查: ${log.ibCheck || 'N/A'}

=== 执行日志详情 ===
${log.executionLog || '无日志'}

=== 导出信息 ===
导出时间: ${new Date().toLocaleString('zh-CN')}
导出来源: GPU节点检查系统`

      // 创建Blob对象
      const blob = new Blob([exportContent], {
        type: 'text/plain;charset=utf-8'
      })

      // 创建下载链接
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `gpu_check_${log.nodeName || log.hostname}_${new Date().toISOString().split('T')[0]}.log`
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // 清理URL对象
      URL.revokeObjectURL(url)
      
      console.log('单节点日志导出成功')
    } catch (error) {
      console.error('导出单节点日志失败:', error)
      alert('导出单节点日志失败')
    }
  }

  // ...existing code...

  return (
    <>
      <SummaryCards summary={summary} theme={theme} t={t} />

      {/* 错误提示 */}
      {error && (
        <Card
          className={`mb-6 border-red-200 transition-colors duration-200 ${
            theme === "dark" ? "bg-red-900/20 border-red-700" : "bg-red-50"
          }`}
        >
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800 dark:text-red-400">
              <XCircle className="w-5 h-5 mr-2" />
              <span>
                {t.error}: {error}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <NodeDetailsTable
        data={data}
        loading={loading}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        onRefresh={handleRefresh}
        onExportLogs={handleExportLogs}
        onViewLog={handleViewLog}
        refreshDisabled={inspectionRefreshDisabled}
        countdown={inspectionCountdown}
        theme={theme}
        t={t}
        gpuBenchmarks={gpuBenchmarks}
        getFinalResult={getFinalResult}
        formatExecutionTime={formatExecutionTime}
      />

      {/* 检查项目描述 */}
      <Card
        className={`mt-6 transition-colors duration-200 ${
          theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        <CardHeader>
          <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            {t.checkItemsDesc}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`space-y-4 text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
            <div>
              <strong>bandwidthTest:</strong> {t.bandwidthTestDesc}
            </div>
            <div>
              <strong>p2pBandwidthLatencyTest:</strong> {t.p2pTestDesc}
            </div>
            <div>
              <strong>{t.ncclTest}:</strong> {t.ncclTestDesc}
            </div>
            <div>
              <strong>{t.dcgmDiagnostic}:</strong> {t.dcgmDesc}
              
              {/* DCGM诊断级别详细说明表格 */}
              <div className="mt-3">
                <p className={`text-xs mb-2 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                  DCGM诊断级别详细说明：
                </p>
                <div className={`rounded-md border overflow-x-auto transition-colors duration-200 ${
                  theme === "dark" ? "border-gray-700" : "border-gray-200"
                }`}>
                  <table className={`w-full text-xs ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
                    <thead>
                      <tr className={theme === "dark" ? "bg-gray-700" : "bg-gray-50"}>
                        <th className={`p-2 text-left border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          Plugin
                        </th>
                        <th className={`p-2 text-left border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          Test name
                        </th>
                        <th className={`p-2 text-center border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          r1 (Short)<br/>Seconds
                        </th>
                        <th className={`p-2 text-center border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          r2 (Medium)<br/>&lt;2 mins
                        </th>
                        <th className={`p-2 text-center border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          r3 (Long)<br/>&lt;30 mins
                        </th>
                        <th className={`p-2 text-center border-b ${theme === "dark" ? "border-gray-600" : "border-gray-200"}`}>
                          r4 (Extra Long)<br/>1-2 hours
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Software</td>
                        <td className="p-2 border-b">software</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">PCIe + NVLink</td>
                        <td className="p-2 border-b">pcie</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">GPU Memory</td>
                        <td className="p-2 border-b">memory</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Memory Bandwidth</td>
                        <td className="p-2 border-b">memory_bandwidth</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Diagnostics</td>
                        <td className="p-2 border-b">diagnostic</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Targeted Stress</td>
                        <td className="p-2 border-b">targeted_stress</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Targeted Power</td>
                        <td className="p-2 border-b">targeted_power</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">NVBandwidth</td>
                        <td className="p-2 border-b">nvbandwidth</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Memory Stress</td>
                        <td className="p-2 border-b">memtest</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                      <tr className={theme === "dark" ? "border-gray-600" : "border-gray-200"}>
                        <td className="p-2 border-b">Input EDPp</td>
                        <td className="p-2 border-b">pulse</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">-</td>
                        <td className="p-2 border-b text-center">Yes</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div>
              <strong>{t.ibCheck}:</strong> {t.ibCheckDesc}
            </div>
            <div>
              <strong>{t.checkResult}:</strong> {t.finalResultDesc}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GPU性能基准值对照表 */}
      <Card
        className={`mt-6 transition-colors duration-200 ${
          theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        }`}
      >
        <CardHeader>
          <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
            {t.gpuBenchmarks}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`rounded-md border overflow-x-auto transition-colors duration-200 ${
              theme === "dark" ? "border-gray-700" : "border-gray-200"
            }`}
          >
            <Table>
              <TableHeader>
                <TableRow className={theme === "dark" ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-50"}>
                  <TableHead
                    className={`font-semibold text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                  >
                    {t.gpuModel}
                  </TableHead>
                  <TableHead
                    className={`font-semibold text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                  >
                    P2PBandwidthLatencyTest
                  </TableHead>
                  <TableHead
                    className={`font-semibold text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                  >
                    NCCL_Tests
                  </TableHead>
                  <TableHead
                    className={`font-semibold text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                  >
                    BandwidthTest
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(defaultGpuBenchmarks).map((gpuType) => {
                  const benchmark = gpuBenchmarks[gpuType] ?? defaultGpuBenchmarks[gpuType]
                  return (
                    <TableRow
                      key={gpuType}
                      className={`${
                        usedGpuTypes.includes(gpuType)
                          ? theme === "dark"
                            ? "bg-blue-900/30 border-l-4 border-l-blue-400 bg-gradient-to-r from-blue-900/20 to-blue-800/10"
                            : "bg-blue-50 border-l-4 border-l-blue-500"
                          : theme === "dark"
                            ? "hover:bg-gray-700"
                            : "hover:bg-gray-50"
                      } transition-colors duration-200`}
                    >
                      <TableCell
                        className={`font-medium text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}
                      >
                        {gpuType}
                      </TableCell>
                      <TableCell className={`text-center font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{benchmark.p2p}</TableCell>
                      <TableCell className={`text-center font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{benchmark.nccl}</TableCell>
                      <TableCell className={`text-center font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{benchmark.bw}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <p className={`text-xs mt-4 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>{t.benchmarkNote}</p>
        </CardContent>
      </Card>

      {/* 执行日志查看对话框 */}
      <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
        <DialogContent
          className={`max-w-5xl max-h-[90vh] ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white"}`}
        >
          <DialogHeader>
            <DialogTitle className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.logTitle}</DialogTitle>
            <DialogDescription className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
              {t.logDesc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[calc(90vh-200px)] overflow-y-auto">
            {selectedLog && (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.hostName}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedLog.nodeName || selectedLog.hostname}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.gpuType}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {selectedLog.gpuType}
                    </span>
                  </div>
                  <div>
                    <span className={`font-medium ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                      {t.completionTime || "完成时间"}:
                    </span>
                    <span className={`ml-2 ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {formatExecutionTime(selectedLog.completedAt || selectedLog.timestamp || selectedLog.createdAt || selectedLog.executionTime)}
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
                      onClick={() => handleExportLog(selectedLog)}
                      className={`${
                        theme === "dark"
                          ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                          : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                      }`}
                    >
                      <Download className="w-4 h-4 mr-1" />
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
                      {selectedLog.executionLog || t.noLog}
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
