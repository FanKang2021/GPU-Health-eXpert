"use client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle, XCircle, RefreshCw, Download, FileText, ChevronUp, ChevronDown } from "lucide-react"

interface NodeDetailsTableProps {
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
  onRefresh: () => void
  onExportLogs: () => void
  onViewLog: (node: any) => void
  refreshDisabled: boolean
  countdown: number
  theme: "light" | "dark"
  t: any // i18n text object
  gpuBenchmarks: any
  getFinalResult: (item: any) => string
  formatExecutionTime: (timestamp: string) => string
}

export function NodeDetailsTable({
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
  onRefresh,
  onExportLogs,
  onViewLog,
  refreshDisabled,
  countdown,
  theme,
  t,
  gpuBenchmarks,
  getFinalResult,
  formatExecutionTime,
}: NodeDetailsTableProps) {
  // 解析数值（去除单位）
  const parseValue = (valueStr: string | null | undefined): number => {
    if (!valueStr || typeof valueStr !== 'string') {
      return 0
    }
    return Number.parseFloat(valueStr.replace(/[^\d.]/g, "")) || 0
  }

  // 状态徽章组件
  const StatusBadge = ({ status }: { status: string }) => {
    return status === "Pass" ? (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400">
        <CheckCircle className="w-3 h-3 mr-1" />
        {t.pass}
      </Badge>
    ) : (
      <Badge variant="destructive" className="dark:bg-red-900/20 dark:text-red-400">
        <XCircle className="w-3 h-3 mr-1" />
        {t.noPass}
      </Badge>
    )
  }

  // 性能单元格组件
  const PerformanceCell = ({
    value,
    gpuType,
    testType,
  }: {
    value: string
    gpuType: string
    testType: "bw" | "p2p" | "nccl"
  }) => {
    const benchmark = gpuBenchmarks[gpuType as keyof typeof gpuBenchmarks]
    if (!benchmark) return <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{value}</span>

    const numericValue = parseValue(value)
    const benchmarkValue = benchmark[testType]
    const isPass = numericValue >= benchmarkValue

    return (
      <div className="flex items-center space-x-2">
        <span className={theme === "dark" ? "text-white" : "text-gray-900"}>{value}</span>
        <span className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
          ({t.benchmarkValue}: {benchmarkValue} GB/s)
        </span>
        {isPass ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
      </div>
    )
  }

  // 节点状态判断函数 - 根据所有测试结果判断节点是否通过
  const getNodeStatus = (item: any): string => {
    if (!item) return 'Unknown'
    
    // 检查DCGM和IB状态
    const dcgmStatus = item.dcgmDiag
    const ibStatus = item.ibCheck
    
    if (dcgmStatus !== 'Pass' || ibStatus !== 'Pass') {
      return 'No Pass'
    }
    
    // 检查性能测试结果
    const gpuType = item.gpuType
    const benchmark = gpuBenchmarks[gpuType as keyof typeof gpuBenchmarks]
    
    if (!benchmark) return 'Unknown'
    
    // 检查带宽测试
    const bandwidthValue = parseValue(item.bandwidthTest)
    if (bandwidthValue < benchmark.bw) {
      return 'No Pass'
    }
    
    // 检查P2P测试
    const p2pValue = parseValue(item.p2pBandwidthLatencyTest)
    if (p2pValue < benchmark.p2p) {
      return 'No Pass'
    }
    
    // 检查NCCL测试
    const ncclValue = parseValue(item.ncclTests)
    if (ncclValue < benchmark.nccl) {
      return 'No Pass'
    }
    
    // 所有测试都通过
    return 'Pass'
  }

  // 获取GPU类型（兼容新旧两种格式）
  const getGpuType = (node: any) => {
    return node.gpuType || "Unknown"
  }

  // 格式化时间显示 - 支持多种时间格式
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
      
      // 如果是执行时长格式（如 0:00:00.143453），跳过不显示
      if (timeStr.includes(':') && timeStr.includes('.') && timeStr.startsWith('0:')) {
        return 'N/A' // 不显示执行时长
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

  // 获取节点名称（兼容新旧两种格式）
  const getNodeName = (node: any) => {
    return node.nodeName || node.hostname || "Unknown"
  }

  // 过滤数据
  const filteredData = data.filter((item) =>
    (item.nodeName || item.hostname)?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // 排序数据
  const sortedData = [...filteredData].sort((a, b) => {
    if (sortField === "checkResult") {
      const resultA = a.inspectionResult || getFinalResult(a)
      const resultB = b.inspectionResult || getFinalResult(b)

      // 按照通过/未通过的逻辑排序：Pass在前，No Pass在后
      if (sortDirection === "asc") {
        // 升序：Pass在前，No Pass在后
        if (resultA === "Pass" && resultB === "No Pass") {
          return -1
        }
        if (resultA === "No Pass" && resultB === "Pass") {
          return 1
        }
        return 0
      } else {
        // 降序：No Pass在前，Pass在后
        if (resultA === "No Pass" && resultB === "Pass") {
          return -1
        }
        if (resultA === "Pass" && resultB === "No Pass") {
          return 1
        }
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
      className={`transition-colors duration-200 ${
        theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
      }`}
    >
      <CardHeader>
        <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
          {t.nodeDetails}
        </CardTitle>
        <CardDescription className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
          {t.nodeDetailsDesc}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <Input
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className={`max-w-sm ${
                theme === "dark" ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400" : ""
              }`}
            />
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={refreshDisabled || loading}
                className={`transition-all duration-300 ease-in-out transform hover:scale-105 active:scale-95 ${
                  refreshDisabled
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white hover:shadow-lg"
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : "transition-transform duration-300 hover:rotate-180"}`} />
                <span>{refreshDisabled ? `等待中... (${countdown}s)` : t.refresh}</span>
              </Button>
              <Button
                variant="default"
                onClick={onExportLogs}
                className={`flex items-center space-x-2 ${
                  theme === "dark"
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                <Download className="w-4 h-4" />
                <span>{t.exportLog}.zip</span>
              </Button>
            </div>
          </div>
        </div>
        <div
          className={`rounded-md border transition-colors duration-200 ${
            theme === "dark" ? "border-gray-700" : "border-gray-200"
          }`}
        >
          <Table>
            <TableHeader>
              <TableRow className={theme === "dark" ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-50"}>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.hostName}</TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.gpuType}</TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>bandwidthTest</TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>
                  p2pBandwidthLatencyTest
                </TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.ncclTest}</TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.dcgmDiagnostic}</TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.ibCheck}</TableHead>
                <TableHead
                  className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors duration-200 text-center ${
                    theme === "dark" ? "text-white" : "text-gray-900"
                  }`}
                  onClick={() => onSort("checkResult")}
                  title={sortField === "checkResult" ? (sortDirection === "asc" ? t.sortDesc : t.sortAsc) : t.sortAsc}
                >
                  <div className="flex items-center justify-center space-x-1">
                    <span>{t.nodeStatus}</span>
                    <div className="flex flex-col">
                      {sortField === "checkResult" ? (
                        sortDirection === "asc" ? (
                          <ChevronUp className="w-3 h-3 text-blue-500" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-blue-500" />
                        )
                      ) : (
                        <div className="flex flex-col">
                          <ChevronUp className="w-3 h-3 text-gray-400" />
                          <ChevronDown className="w-3 h-3 text-blue-500" />
                        </div>
                      )}
                    </div>
                  </div>
                </TableHead>
                <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.executionLog}</TableHead>
                                        <TableHead className={theme === "dark" ? "text-white" : "text-gray-900"}>{t.completionTime || "完成时间"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    <div className="flex items-center justify-center">
                      <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                      {t.loading}
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-gray-500 dark:text-gray-400">
                    {t.noData}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((item, index) => (
                  <TableRow
                    key={index}
                    className={theme === "dark" ? "hover:bg-gray-700 border-gray-700" : "hover:bg-gray-50"}
                  >
                    <TableCell className={`font-medium ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                      {item.nodeName || item.hostname}
                    </TableCell>
                    <TableCell className={theme === "dark" ? "text-white" : "text-gray-900"}>{item.gpuType}</TableCell>
                    <TableCell>
                      <PerformanceCell value={item.bandwidthTest} gpuType={item.gpuType} testType="bw" />
                    </TableCell>
                    <TableCell>
                      <PerformanceCell value={item.p2pBandwidthLatencyTest} gpuType={item.gpuType} testType="p2p" />
                    </TableCell>
                    <TableCell>
                      <PerformanceCell value={item.ncclTests} gpuType={item.gpuType} testType="nccl" />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.dcgmDiag} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.ibCheck} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={getNodeStatus(item)} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewLog(item)}
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
                      {formatTime(item.completedAt || item.timestamp || item.createdAt || item.executionTime)}
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
              {t.showing} {startIndex + 1}-{Math.min(endIndex, filteredData.length)} {t.of} {filteredData.length}{" "}
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
