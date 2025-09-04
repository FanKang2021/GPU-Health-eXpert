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
  theme: "light" | "dark"
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
  theme,
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
      return theme === "dark"
        ? "bg-green-900/20 text-green-400 border-green-500"
        : "bg-green-50 text-green-700 border-green-500"
    } else {
      return theme === "dark" ? "bg-red-900/20 text-red-400 border-red-500" : "bg-red-50 text-red-700 border-red-500"
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
    <Card
      className={`mt-6 transition-colors duration-200 ${
        theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
      }`}
    >
      <CardHeader>
        <div className="space-y-4">
          {/* 主标题和描述 */}
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                {t.gpuNodeStatus}
              </CardTitle>
              <CardDescription className={theme === "dark" ? "text-gray-400" : "text-gray-600"}>
                {t.gpuNodeStatusDesc}
              </CardDescription>
            </div>
          </div>
          
          {/* 状态信息栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 最后刷新时间 */}
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                  {t.lastRefresh}:
                </span>
                <span className={`text-sm font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
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
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    theme === "dark" ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700"
                  }`}>
                    {gpuNodeStatus.length} {t.nodes}
                  </span>
                )}
              </div>
              
              {/* 刷新状态指示器 */}
              <div className="flex items-center space-x-2">
                {gpuStatusRefreshDisabled ? (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    theme === "dark" ? "bg-blue-900/20 text-blue-400" : "bg-blue-100 text-blue-800"
                  }`}>
                    {nextRefreshTime > 0 
                      ? `${t.waiting} (${gpuStatusCountdown}s)`
                      : `${t.cooling} (${gpuStatusCountdown}s)`
                    }
                  </span>
                ) : (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    theme === "dark" ? "bg-green-900/20 text-green-400" : "bg-green-100 text-green-800"
                  }`}>
                    {t.refreshable}
                  </span>
                )}
              </div>
              
              {/* 刷新尝试次数 */}
              {refreshAttempts > 0 && (
                <div className="flex items-center space-x-2">
                  <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                    {t.refreshAttempts}:
                  </span>
                  <span className={`text-xs font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                    {refreshAttempts}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-3">
              {/* 自动刷新开关 */}
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                  {t.autoRefresh}:
                </span>
                <Button
                  variant={autoRefreshEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={onAutoRefreshToggle}
                  className={`text-xs ${
                    autoRefreshEnabled
                      ? "bg-blue-600 text-white"
                      : theme === "dark"
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
                  }`}
                >
                  {autoRefreshEnabled ? t.on : t.off}
                </Button>
              </div>
              
              {/* 刷新状态指示器 */}
              {autoRefreshEnabled && refreshState && (
                <div className="flex items-center space-x-2">
                  <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                    刷新状态:
                  </span>
                  <div className={`px-2 py-1 rounded text-xs ${
                    refreshState.isRefreshing
                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400"
                      : "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                  }`}>
                    {refreshState.isRefreshing ? "刷新中..." : "就绪"}
                  </div>
                  {getNextRefreshTimeDisplay && (
                    <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
                      下次: {getNextRefreshTimeDisplay()}
                    </span>
                  )}
                  {getCurrentRefreshIntervalDisplay && (
                    <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}>
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
            <div className={`p-3 rounded-md border-2 border-red-200 ${
              theme === "dark" ? "bg-red-900/20 border-red-700" : "bg-red-50"
            }`}>
              <div className="flex items-center text-red-800 dark:text-red-400">
                <span className="text-sm">
                  {refreshError}
                </span>
              </div>
            </div>
          )}
          
          {/* 页面状态提示 */}
          {!hasInitialized && (
            <div className={`p-3 rounded-md border-2 border-blue-200 ${
              theme === "dark" ? "bg-blue-900/20 border-blue-700" : "bg-blue-50"
            }`}>
              <div className="flex items-center text-blue-800 dark:text-blue-400">
                <span className="text-sm">
                  ℹ️ {t.pageInitialized}
                </span>
              </div>
            </div>
          )}
          
          {/* 下次刷新时间提示 */}
          {nextRefreshTime > 0 && (
            <div className={`p-2 rounded-md border-2 border-blue-200 ${
              theme === "dark" ? "bg-blue-900/20 border-blue-700" : "bg-blue-50"
            }`}>
              <div className="flex items-center text-blue-800 dark:text-blue-400">
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
            className={`max-w-sm mb-4 ${
              theme === "dark" ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400" : ""
            }`}
          />
        </div>
        <div
          className={`rounded-md border overflow-x-auto transition-colors duration-200 ${
            theme === "dark" ? "border-gray-700" : "border-gray-200"
          }`}
        >
          <Table>
            <TableHeader>
              <TableRow className={theme === "dark" ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-50"}>
                <TableHead className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                  {t.hostName}
                </TableHead>
                <TableHead className={`font-semibold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                  {t.gpuType}
                </TableHead>
                <TableHead className={`font-semibold text-center ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                  {t.gpuRequested}
                </TableHead>
                <TableHead
                  className={`font-semibold text-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors duration-200 ${
                    theme === "dark" ? "text-white" : "text-gray-900"
                  }`}
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
                    className={theme === "dark" ? "hover:bg-gray-700 border-gray-700" : "hover:bg-gray-50"}
                  >
                    <TableCell className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {node.nodeName || node.hostname}
                    </TableCell>
                    <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>
                      {getGpuTypeDisplayName(node.gpuModel || "")}
                    </TableCell>
                    <TableCell className={`text-center font-mono ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
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
            <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-700"}`}>
              {t.showing} {startIndex + 1}-{Math.min(endIndex, sortedData.length)} {t.of} {sortedData.length}{" "}
              {t.records}
            </div>
            <div className="flex items-center space-x-2">
              <span className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>
                {t.showPerPage}:
              </span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 ${
                  theme === "dark" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-300 bg-white text-gray-700"
                }`}
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
              className={`px-3 py-1 ${
                theme === "dark"
                  ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
              }`}
            >
              {t.previousPage}
            </Button>

            <div className="flex items-center space-x-1">
              {generatePageNumbers(totalPages).map((pageInfo, index) =>
                pageInfo.type === "ellipsis" ? (
                  <span
                    key={`ellipsis-${index}`}
                    className={`px-2 py-1 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
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
                      currentPage !== pageInfo.page && theme === "dark"
                        ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                        : ""
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
      </CardContent>
    </Card>
  )
}
