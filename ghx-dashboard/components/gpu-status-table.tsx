"use client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { RefreshCw, ChevronUp, ChevronDown } from "lucide-react"

interface GpuStatusTableProps {
  data: any[]
  loading: boolean
  searchTerm: string
  onSearchChange: (value: string) => void
  sortField: string
  sortDirection: "asc" | "desc"
  onSort: (field: string) => void
  currentPage: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  t: any // i18n text object
  // 状态信息相关属性
  lastRefreshTime: number
  gpuNodeStatus: any[]
  mockGpuStatusData: any[]
  gpuStatusRefreshDisabled: boolean
  nextRefreshTime: number
  gpuStatusCountdown: number
  refreshAttempts: number
  autoRefreshEnabled: boolean
  onAutoRefreshToggle: () => void
  onRefresh: () => void
  gpuStatusLoading: boolean
  refreshError: string | null
  hasInitialized: boolean
  // 新增：优化后的刷新状态信息
  refreshState?: {
    lastRefresh: number
    isRefreshing: boolean
    nextRefreshTime: number
  }
  getNextRefreshTimeDisplay?: () => string
  getCurrentRefreshIntervalDisplay?: () => string
}

export function GpuStatusTable({
  data,
  loading,
  searchTerm,
  onSearchChange,
  sortField,
  sortDirection,
  onSort,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  t,
  // 状态信息相关参数
  lastRefreshTime,
  gpuNodeStatus,
  mockGpuStatusData,
  gpuStatusRefreshDisabled,
  nextRefreshTime,
  gpuStatusCountdown,
  refreshAttempts,
  autoRefreshEnabled,
  onAutoRefreshToggle,
  onRefresh,
  gpuStatusLoading,
  refreshError,
  hasInitialized,
  // 新增：优化后的刷新状态信息
  refreshState,
  getNextRefreshTimeDisplay,
  getCurrentRefreshIntervalDisplay,
}: GpuStatusTableProps) {
  // 获取GPU类型显示名称
  const getGpuTypeDisplayName = (gpuModel: string) => {
    // 从GPU MODEL中提取GPU类型名称
    if (gpuModel.includes("gpu-h200")) return "H200"
    if (gpuModel.includes("gpu-h100")) return "H100"
    if (gpuModel.includes("gpu-a100")) return "A100"
    if (gpuModel.includes("gpu-a800")) return "A800"
    if (gpuModel.includes("gpu-h800")) return "H800"
    if (gpuModel.includes("gpu-h20")) return "H20"
    if (gpuModel.includes("gpu-rtx-3090")) return "RTX 3090"
    if (gpuModel.includes("gpu-rtx-4090")) return "RTX 4090"
    if (gpuModel.includes("gpu-l40s")) return "L40S"
    return gpuModel
  }

  // 获取节点状态显示名称
  const getNodeStatusDisplay = (gpuRequested: number) => {
    return gpuRequested === 0 ? t.idle : t.busy
  }

  // 获取节点状态样式
  const getNodeStatusStyle = (gpuRequested: number) => {
    if (gpuRequested === 0) {
      return "bg-tech-green/20 text-tech-green border-tech-green"
    } else {
      return "bg-tech-red/20 text-tech-red border-tech-red"
    }
  }

  // 获取最终结果（兼容新旧两种格式）
  const getFinalResult = (node: any) => {
    // 新格式：Job诊断结果
    if (node.originalResult?.inspectionResult) {
      return node.originalResult.inspectionResult
    }
    
    // 旧格式：节点检查详情
    if (node.bandwidthTest && node.p2pBandwidthLatencyTest && node.ncclTests) {
      // 检查所有测试是否通过
      const tests = [
        node.bandwidthTest,
        node.p2pBandwidthLatencyTest,
        node.ncclTests,
        node.dcgmDiag,
        node.ibCheck
      ]
      
      // 过滤掉N/A，只检查有结果的测试
      const validTests = tests.filter(test => test !== 'N/A')
      if (validTests.length === 0) return 'Unknown'
      
      return validTests.every(test => test === "Pass" || test.includes("GB/s")) ? "Pass" : "Fail"
    }
    
    return "Unknown"
  }

  // 获取GPU类型（兼容新旧两种格式）
  const getGpuType = (node: any) => {
    return node.gpuType || "Unknown"
  }

  // 获取节点名称（兼容新旧两种格式）
  const getNodeName = (node: any) => {
    return node.nodeName || node.hostname || "Unknown"
  }

  // 过滤数据
  const filteredData = data.filter((node) =>
    (node.nodeName || node.hostname)?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // 排序数据（基于节点状态：空闲在前，忙碌在后）
  const sortedData = [...filteredData].sort((a, b) => {
    const statusA = a.gpuRequested || 0
    const statusB = b.gpuRequested || 0

    if (sortField === "nodeStatus") {
      if (sortDirection === "asc") {
        // 升序：空闲在前，忙碌在后
        if (statusA === 0 && statusB > 0) return -1
        if (statusA > 0 && statusB === 0) return 1
        return 0
      } else {
        // 降序：忙碌在前，空闲在后
        if (statusA > 0 && statusB === 0) return -1
        if (statusA === 0 && statusB > 0) return 1
        return 0
      }
    }
    return 0
  })

  // 计算分页数据
  const totalPages = Math.ceil(sortedData.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedData = sortedData.slice(startIndex, endIndex)

  // 生成页码数组，支持省略号显示
  const generatePageNumbers = (totalPages: number) => {
    const pages = []
    const maxVisiblePages = 7 // 最多显示7个页码按钮

    if (totalPages <= maxVisiblePages) {
      // 如果总页数不多，直接显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pages.push({ page: i, type: "number" })
      }
    } else {
      // 如果总页数较多，使用省略号
      if (currentPage <= 4) {
        // 当前页在前几页
        for (let i = 1; i <= 5; i++) {
          pages.push({ page: i, type: "number" })
        }
        pages.push({ page: 6, type: "ellipsis" })
        pages.push({ page: totalPages, type: "number" })
      } else if (currentPage >= totalPages - 3) {
        // 当前页在后几页
        pages.push({ page: 1, type: "number" })
        pages.push({ page: totalPages - 5, type: "ellipsis" })
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push({ page: i, type: "number" })
        }
      } else {
        // 当前页在中间
        pages.push({ page: 1, type: "number" })
        pages.push({ page: currentPage - 2, type: "ellipsis" })
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push({ page: i, type: "number" })
        }
        pages.push({ page: currentPage + 2, type: "ellipsis" })
        pages.push({ page: totalPages, type: "number" })
      }
    }

    return pages
  }

  return (
    <Card className="mt-6 transition-colors duration-200 tech-card bg-gradient-to-br from-secondary/20 to-secondary/10 border-border/50 shadow-glow">
      <CardHeader>
        <div className="space-y-4">
          {/* 主标题和描述 */}
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                {t.gpuNodeStatus}
              </CardTitle>
              <CardDescription className="text-muted-foreground font-mono">
                {t.gpuNodeStatusDesc}
              </CardDescription>
            </div>
          </div>
          
          {/* 状态信息栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 最后刷新时间 */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground font-mono">
                  {t.lastRefresh}:
                </span>
                <span className="text-sm font-mono text-foreground">
                  {lastRefreshTime > 0 
                    ? new Date(lastRefreshTime).toLocaleString("zh-CN", {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })
                    : t.neverRefreshed
                  }
                </span>
              </div>
              
              {/* 数据来源标识 */}
              <div className="flex items-center space-x-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  gpuNodeStatus.length > 0 && gpuNodeStatus !== mockGpuStatusData
                    ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400"
                }`}>
                  {gpuNodeStatus.length > 0 && gpuNodeStatus !== mockGpuStatusData ? t.realTimeData : t.mockData}
                </span>
                
                {/* 数据数量显示 */}
                {gpuNodeStatus.length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-secondary/30 text-muted-foreground font-mono">
                    {gpuNodeStatus.length} {t.nodes}
                  </span>
                )}
              </div>
              
              {/* 刷新状态指示器 */}
              <div className="flex items-center space-x-2">
                {gpuStatusRefreshDisabled ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-tech-blue/20 text-tech-blue font-mono">
                    {nextRefreshTime > 0 
                      ? `${t.waiting} (${gpuStatusCountdown}s)`
                      : `${t.cooling} (${gpuStatusCountdown}s)`
                    }
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-full bg-tech-green/20 text-tech-green font-mono">
                    {t.refreshable}
                  </span>
                )}
              </div>
              
              {/* 刷新尝试次数 */}
              {refreshAttempts > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {t.refreshAttempts}:
                  </span>
                  <span className="text-xs font-mono text-foreground">
                    {refreshAttempts}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-3">
              {/* 自动刷新开关 */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-muted-foreground font-mono">
                  {t.autoRefresh}:
                </span>
                <Button
                  variant={autoRefreshEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={onAutoRefreshToggle}
                  className={`text-xs ${
                    autoRefreshEnabled
                      ? "tech-button bg-gradient-primary text-white"
                      : "tech-button border-tech-blue/50 hover:bg-tech-blue/20"
                  }`}
                >
                  {autoRefreshEnabled ? t.on : t.off}
                </Button>
              </div>
              
              {/* 刷新状态指示器 */}
              {autoRefreshEnabled && refreshState && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    刷新状态:
                  </span>
                  <div className={`px-2 py-1 rounded text-xs ${
                    refreshState.isRefreshing
                      ? "bg-tech-yellow/20 text-tech-yellow"
                      : "bg-tech-green/20 text-tech-green"
                  }`}>
                    {refreshState.isRefreshing ? "刷新中..." : "就绪"}
                  </div>
                  {getNextRefreshTimeDisplay && (
                    <span className="text-xs text-muted-foreground font-mono">
                      下次: {getNextRefreshTimeDisplay()}
                    </span>
                  )}
                  {getCurrentRefreshIntervalDisplay && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {getCurrentRefreshIntervalDisplay()}
                    </span>
                  )}
                </div>
              )}
              
              {/* 统一刷新按钮 */}
              <Button
                variant="outline"
                onClick={onRefresh}
                disabled={gpuStatusLoading || gpuStatusRefreshDisabled}
                className={`transition-all duration-300 ease-in-out transform hover:scale-105 active:scale-95 ${
                  gpuStatusLoading || gpuStatusRefreshDisabled
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg"
                }`}
              >
                {gpuStatusLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2 transition-transform duration-300 hover:rotate-180" />
                )}
                {gpuStatusLoading ? t.refreshing : t.refresh}
              </Button>
            </div>
          </div>
          
          {/* 错误信息显示 */}
          {refreshError && (
            <div className="p-3 rounded-md border-2 border-tech-red/30 bg-tech-red/10">
              <div className="flex items-center text-tech-red">
                <span className="text-sm">
                  {refreshError}
                </span>
              </div>
            </div>
          )}
          
          {/* 页面状态提示 */}
          {!hasInitialized && (
            <div className="p-3 rounded-md border-2 border-tech-blue/30 bg-tech-blue/10">
              <div className="flex items-center text-tech-blue">
                <span className="text-sm">
                  ℹ️ {t.pageInitialized}
                </span>
              </div>
            </div>
          )}
          
          {/* 下次刷新时间提示 */}
          {nextRefreshTime > 0 && (
            <div className="p-2 rounded-md border-2 border-tech-blue/30 bg-tech-blue/10">
              <div className="flex items-center text-tech-blue">
                <span className="text-sm">
                  📅 {t.nextRefreshTime}: {new Date(nextRefreshTime).toLocaleString("zh-CN", {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Input
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="tech-input max-w-sm mb-4"
          />
        </div>
        <div className="rounded-md border overflow-x-auto transition-colors duration-200 border-border/50 bg-secondary/20 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50 hover:bg-secondary/70">
                <TableHead className="font-semibold text-tech-blue">
                  {t.hostName}
                </TableHead>
                <TableHead className="font-semibold text-tech-green">
                  {t.gpuType}
                </TableHead>
                <TableHead className="font-semibold text-center text-tech-yellow">
                  {t.gpuRequested}
                </TableHead>
                <TableHead
                  className="font-semibold text-center cursor-pointer hover:bg-secondary/60 transition-colors duration-200 text-tech-orange"
                  onClick={() => onSort("nodeStatus")}
                  title={sortField === "nodeStatus" ? (sortDirection === "asc" ? t.sortDesc : t.sortAsc) : t.sortAsc}
                >
                  <div className="flex items-center justify-center space-x-1">
                    <span>{t.nodeStatus}</span>
                    <div className="flex flex-col">
                      {sortField === "nodeStatus" ? (
                        sortDirection === "asc" ? (
                          <ChevronUp className="w-3 h-3 text-blue-500" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-blue-500" />
                        )
                      ) : (
                        <div className="flex flex-col">
                          <ChevronUp className="w-3 h-3 text-gray-400" />
                          <ChevronDown className="w-3 h-3 text-gray-400" />
                        </div>
                      )}
                    </div>
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                      {t.loading}
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-500 dark:text-gray-400">
                    {t.noData}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((node, index) => (
                  <TableRow
                    key={index}
                    className="hover:bg-secondary/30 border-border/50 transition-colors duration-200"
                  >
                    <TableCell className="font-medium text-foreground">
                      {node.nodeName || node.hostname}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {getGpuTypeDisplayName(node.gpuModel || "")}
                    </TableCell>
                    <TableCell className="text-center font-mono text-foreground">
                      {node.gpuRequested || 0}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`border-2 ${getNodeStatusStyle(node.gpuRequested || 0)}`}>
                        {getNodeStatusDisplay(node.gpuRequested || 0)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 分页控件 */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-sm text-muted-foreground font-mono">
              {t.showing} {startIndex + 1}-{Math.min(endIndex, sortedData.length)} {t.of} {sortedData.length}{" "}
              {t.records}
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground font-mono">
                {t.showPerPage}:
              </span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="tech-input border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-tech-blue transition-colors duration-200"
              >
                <option value={10}>10 {t.rows}</option>
                <option value={20}>20 {t.rows}</option>
                <option value={50}>50 {t.rows}</option>
              </select>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="tech-button px-3 py-1"
            >
              {t.previousPage}
            </Button>

            <div className="flex items-center space-x-1">
              {generatePageNumbers(totalPages).map((pageInfo, index) =>
                pageInfo.type === "ellipsis" ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 py-1 text-muted-foreground"
                  >
                    ...
                  </span>
                ) : (
                  <Button
                    key={pageInfo.page}
                    variant={currentPage === pageInfo.page ? "default" : "outline"}
                    size="sm"
                    onClick={() => onPageChange(pageInfo.page)}
                    className={`w-8 h-8 ${
                      currentPage === pageInfo.page
                        ? "tech-button bg-gradient-primary text-white"
                        : "tech-button border-tech-blue/50 hover:bg-tech-blue/20"
                    }`}
                  >
                    {pageInfo.page}
                  </Button>
                ),
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="tech-button px-3 py-1"
            >
              {t.nextPage}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
