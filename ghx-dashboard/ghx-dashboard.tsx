"use client"
// 动态加载 gpu-benchmarks.js，确保 window.GPU_BENCHMARKS 可用
if (typeof window !== "undefined") {
  const scriptId = "gpu-benchmarks-script"
  if (!document.getElementById(scriptId)) {
    const script = document.createElement("script")
    script.src = "/gpu-benchmarks.js"
    script.id = scriptId
    script.async = false
    document.head.appendChild(script)
  }
}

import { useState, useEffect } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardContent } from "@/components/dashboard-content"
import TroubleshootingPage from "@/components/troubleshooting-page" // Import TroubleshootingPage component
import BurnInPage from "@/components/burn-in-page" // Import BurnInPage component

// 国际化文本配置
const i18n = {
  zh: {
    title: "GHealthX（GPU Health eXpert）",
    subtitle: "每日定时检查GPU节点的性能测试和诊断结果",
    lastUpdated: "最后更新时间",
    summary: "统计摘要",
    summaryDesc: "查看所有GPU节点的检查结果概览",
    totalNodes: "总节点数",
    totalNodesDesc: "GPU节点总数",
    idleNodes: "空闲节点",
    idleNodesDesc: "可用于诊断的节点",
    busyNodes: "忙碌节点",
    busyNodesDesc: "正在使用中的节点",
    passedNodes: "通过节点",
    failedNodes: "失败节点",
    refresh: "刷新",
    export: "导出",
    error: "错误",
    nodeDetails: "节点检查详情",
    nodeDetailsDesc: "查看每个GPU节点的详细检查结果和性能指标(绿色表示达到基准值,红色表示未达标)",
    searchPlaceholder: "搜索主机名称...",
    hostName: "主机名称",
    gpuType: "GPU类型",
    gpuModel: "GPU型号",
    checkResult: "检查结果",
    ncclTest: "NCCL测试",
    dcgmDiagnostic: "DCGM诊断", 
    ibCheck: "IB检查",
    executionLog: "执行日志",
    executionTime: "完成时间",
    sortAsc: "升序排列",
    sortDesc: "降序排列",
    noData: "暂无数据",
    loading: "加载中...",
    showPerPage: "每页显示",
    rows: "行",
    previousPage: "上一页",
    nextPage: "下一页",
    showing: "显示",
    of: "条，共",
    records: "条记录",
    checkItemsDesc: "检查项目说明",
    nvbandwidthTestDesc: "测试CPU与GPU间内存拷贝带宽性能，使用nvbandwidth工具评估数据传输效率",
    p2pTestDesc: "测试GPU间点对点通信带宽和延迟，评估多GPU协作性能",
    ncclTestDesc: "测试NVIDIA集合通信库性能，评估分布式训练通信效率",
    dcgmDesc: "NVIDIA数据中心GPU管理器诊断，检查GPU硬件健康状态",
    ibCheckDesc: "InfiniBand网络连接检查，确保高速网络通信正常",
    // 新增：表头翻译
    nvbandwidthTest: "内存拷贝带宽测试",
    p2pBandwidthLatencyTest: "P2P测试",
    ncclTests: "NCCL测试",
    dcgmDiag: "DCGM诊断",
    ibCheck: "IB检查",
    finalResultDesc: "综合所有检查项目的最终结果判定",
    gpuBenchmarks: "GPU性能基准值对照表",
    benchmarkNote: "注：蓝色高亮显示当前环境中使用的GPU型号基准值",
    benchmarkValue: "基准值",
    viewLog: "查看日志",
    exportLog: "导出日志",
    logTitle: "执行日志详情",
    logDesc: "查看GPU节点检查的详细执行日志",
    noLog: "暂无日志信息",
    timestamp: "时间戳",
    gpuRequested: "已请求GPU数量",
    nodeStatus: "节点状态",
    idle: "空闲",
    busy: "忙碌",
    refreshStatus: "刷新",
    // 新增的国际化文本
    selfServiceDiagnostic: "自助故障诊断",
    burnInTest: "烧机专区",
    burnInTestDesc: "GPU烧机测试和实时监控",
    selfServiceDiagnosticDesc: "选择空闲节点和检查项目进行诊断（请先刷新GPU节点资源状态获取最新的空闲节点）",
    selectIdleNodes: "选择空闲节点",
    selectCheckItems: "选择检查项目",
    startDiagnostic: "开始诊断",
    diagnosticRunning: "诊断进行中...",
    noIdleNodes: "暂无空闲节点，请先刷新GPU节点资源状态",
    searchHostname: "搜索主机名称...",
    searchJobIdOrHostname: "搜索Job ID或主机名称...",
    searchJobIdOrHostnameTooltip: "输入Job ID或主机名称进行搜索",
    searchJobIdOrNodeName: "搜索Job ID或节点名称...",
    searchJobIdOrNodeNameTooltip: "输入Job ID或节点名称进行搜索",
    selectAll: "全选",
    deselectAll: "取消全选",
    selected: "已选择",
    nodes: "个节点",
    displayPerPage: "每页显示",
    display: "显示",
    total: "共",
    noMatchingHostname: "未找到匹配的主机名称",
    gpuNodeStatus: "GPU节点状态",
    gpuNodeStatusDesc: "GPU节点资源状态",
    lastRefresh: "最后刷新",
    neverRefreshed: "从未刷新",
    realTimeData: "实时数据",
    mockData: "Mock数据",
    refreshable: "可刷新",
    waiting: "等待中",
    cooling: "冷却中",
    autoRefresh: "自动刷新",
    on: "开启",
    off: "关闭",
    refreshing: "刷新中...",
    refreshCountdown: "等待中...",
    refreshCooldown: "冷却中...",
    refreshAttempts: "尝试次数",
    nextRefreshTime: "下次可刷新时间",
    pageInitialized: "页面已初始化，请点击刷新按钮获取最新数据",
    errorInfo: "错误信息",
    // 诊断任务管理相关
    diagnosticTaskManagement: "诊断任务管理",
    diagnosticTaskManagementDesc: "管理GPU诊断任务的创建、停止和监控",
    noTaskRecords: "暂无任务记录",
    refreshTaskList: "刷新",
    refreshTaskListLoading: "刷新中...",
    // 诊断结果管理相关
    diagnosticResultManagement: "诊断结果管理",
    diagnosticResultManagementDesc: "查看和管理历史诊断结果",
    noDiagnosticResults: "暂无诊断结果",
    refreshResults: "刷新",
    refreshResultsLoading: "刷新中...",
    deleteSelected: "删除选中",
    exportSelected: "导出选中",
    stop: "停止",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    close: "关闭",
    basicInfo: "基本信息",
    node: "节点",
    testResults: "测试结果",
    overallResult: "整体结果",
    performanceTest: "性能测试",
    healthCheck: "健康检查",
    detailedTestResults: "详细测试结果",
    testItems: "测试项",
    creationTime: "创建时间",
    // 分页相关
    items: "条",
    noRecords: "暂无记录",
    completionTime: "完成时间",
    // DCGM诊断级别说明
    dcgmLevelDescription: "DCGM诊断级别详细说明：",
    dcgmDiagnosticLevel: "DCGM诊断级别",
    level1: "级别1",
    level2: "级别2", 
    level3: "级别3",
    level4: "级别4",
    level1Desc: "快速检查（秒级）",
    level2Desc: "标准检查（<2分钟）",
    level3Desc: "详细检查（<30分钟）",
    level4Desc: "全面检查（1-2小时）",
    // 表头翻译
    jobId: "Job ID",
    status: "状态",
    node: "节点",
    testItems: "测试项目",
    dcgmLevel: "DCGM级别",
    creationTime: "创建时间",
    operation: "操作",
    // 诊断结果相关
    diagnosticResults: "诊断结果",
    diagnosticResultDetails: "诊断结果详情",
    diagnosticResultDetailsDesc: "查看诊断结果的详细信息和执行日志",
    diagnosticTime: "诊断时间",
    diagnosticComplete: "诊断完成",
    // 导出相关
    basicInfo: "基本信息",
    nodeName: "节点名称",
    gpuType: "GPU类型",
    jobId: "Job ID",
    dcgmDiagnosticLevel: "DCGM诊断级别",
    completionTime: "完成时间",
    overallResult: "整体结果",
    performanceTest: "性能测试",
    healthCheck: "健康检查",
    testResults: "测试结果",
    executionLog: "执行日志",
    pass: "通过",
    noPass: "未通过",
    // 删除操作相关
    pleaseSelectToDelete: "请选择要删除的项目",
    startBatchDelete: "开始批量删除",
    batchDeleteSuccess: "批量删除成功",
    batchDeleteFailed: "批量删除失败",
    deleteSuccess: "删除成功",
    deleteFailed: "删除失败",
    startDelete: "开始删除",
    diagnosticResultDeleteSuccess: "诊断结果删除成功",
    diagnosticResultDeleteFailed: "删除诊断结果失败",
    jobDeleteSuccess: "Job删除成功",
    pleaseSelectDiagnosticResults: "请选择要删除的诊断结果",
    pleaseSelectJobs: "请选择要删除的Jobs",
    // 其他操作相关
    delayedRefreshFailed: "延迟刷新失败，但删除操作已完成",
    // 页面状态相关
    troubleshootingPageInitialized: "故障排查页面初始化完成，等待用户手动刷新",
    pageSwitchRestoreState: "页面切换后恢复状态",
    // 按钮翻译
    stop: "停止",
    delete: "删除",
  },
  en: {
    title: "GHealthX (GPU Health eXpert)",
    subtitle: "Daily scheduled performance testing and diagnostic results for GPU nodes",
    lastUpdated: "Last Updated",
    summary: "Summary",
    summaryDesc: "View overview of all GPU node inspection results",
    totalNodes: "Total Nodes",
    totalNodesDesc: "Total GPU Nodes",
    idleNodes: "Idle Nodes",
    idleNodesDesc: "Nodes available for diagnosis",
    busyNodes: "Busy Nodes",
    busyNodesDesc: "Nodes currently in use",
    passedNodes: "Passed Nodes",
    failedNodes: "Failed Nodes",
    refresh: "Refresh",
    export: "Export",
    error: "Error",
    nodeDetails: "Node Inspection Details",
    nodeDetailsDesc:
      "View detailed inspection results and performance metrics for each GPU node (Green indicates meeting benchmark, Red indicates below standard)",
    searchPlaceholder: "Search hostname...",
    hostName: "Hostname",
    gpuType: "GPU Type",
    gpuModel: "GPU Model",
    checkResult: "Check Result",
    ncclTest: "NCCL Test",
    dcgmDiagnostic: "DCGM Diagnostic",
    ibCheck: "IB Check", 
    executionLog: "Execution Log",
    executionTime: "Completion Time",
    sortAsc: "Sort Ascending",
    sortDesc: "Sort Descending",
    noData: "No Data",
    loading: "Loading...",
    showPerPage: "Show per page",
    rows: "rows",
    previousPage: "Previous",
    nextPage: "Next",
    showing: "Showing",
    of: "of",
    records: "records",
    checkItemsDesc: "Check Items Description",
    nvbandwidthTestDesc: "Test CPU-GPU memory copy bandwidth performance using nvbandwidth tool, evaluate data transfer efficiency",
    p2pTestDesc: "Test GPU peer-to-peer communication bandwidth and latency, evaluate multi-GPU collaboration performance",
    ncclTestDesc: "Test NVIDIA Collective Communications Library performance, evaluate distributed training communication efficiency",
    dcgmDesc: "NVIDIA Data Center GPU Manager diagnostics, check GPU hardware health status",
    ibCheckDesc: "InfiniBand network connection check, ensure high-speed network communication is normal",
    // 新增：表头翻译
    nvbandwidthTest: "Memory Copy Bandwidth Test",
    p2pBandwidthLatencyTest: "P2P Test",
    ncclTests: "NCCL Tests",
    dcgmDiag: "DCGM Diag",
    ibCheck: "IB Check",
    finalResultDesc: "Final result determination based on all check items",
    gpuBenchmarks: "GPU Performance Benchmark Reference Table",
    benchmarkNote: "Note: Blue highlighting shows benchmark values for GPU models used in current environment",
    pass: "Pass",
    noPass: "No Pass",
    benchmarkValue: "Benchmark",
    // Delete operation related
    pleaseSelectToDelete: "Please select items to delete",
    startBatchDelete: "Start batch delete",
    batchDeleteSuccess: "Batch delete successful",
    batchDeleteFailed: "Batch delete failed",
    deleteSuccess: "Delete successful",
    deleteFailed: "Delete failed",
    startDelete: "Start delete",
    diagnosticResultDeleteSuccess: "Diagnostic result delete successful",
    diagnosticResultDeleteFailed: "Delete diagnostic result failed",
    jobDeleteSuccess: "Job delete successful",
    pleaseSelectDiagnosticResults: "Please select diagnostic results to delete",
    pleaseSelectJobs: "Please select jobs to delete",
    // Other operation related
    delayedRefreshFailed: "Delayed refresh failed, but delete operation completed",
    // Page state related
    troubleshootingPageInitialized: "Troubleshooting page initialization completed, waiting for user manual refresh",
    pageSwitchRestoreState: "Page switch state restored",
    viewLog: "View Log",
    exportLog: "Export Log",
    logTitle: "Execution Log Details",
    logDesc: "View detailed execution logs for GPU node inspection",
    noLog: "No log information available",
    timestamp: "Timestamp",
    gpuRequested: "GPU Requested",
    nodeStatus: "Node Status",
    idle: "Idle",
    busy: "Busy",
    refreshStatus: "Refresh Status",
    // 新增的国际化文本
    selfServiceDiagnostic: "Self-Service Troubleshooting",
    burnInTest: "Burn-in Test",
    burnInTestDesc: "GPU Burn-in Test and Real-time Monitoring",
    selfServiceDiagnosticDesc: "Select idle nodes and check items for diagnosis (please refresh GPU node resource status to get the latest idle nodes)",
    selectIdleNodes: "Select Idle Nodes",
    selectCheckItems: "Select Check Items",
    startDiagnostic: "Start Diagnosis",
    diagnosticRunning: "Diagnosis in Progress...",
    noIdleNodes: "No idle nodes available, please refresh GPU node resource status first",
    searchHostname: "Search hostname...",
    searchJobIdOrHostname: "Search Job ID or Hostname...",
    searchJobIdOrHostnameTooltip: "Enter Job ID or hostname to search",
    searchJobIdOrNodeName: "Search Job ID or Node Name...",
    searchJobIdOrNodeNameTooltip: "Enter Job ID or Node Name to search",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    selected: "Selected",
    nodes: "nodes",
    displayPerPage: "Display per page",
    // 诊断任务管理相关
    diagnosticTaskManagement: "Diagnostic Task Management",
    diagnosticTaskManagementDesc: "Manage the creation, stopping, and monitoring of GPU diagnostic tasks",
    noTaskRecords: "No task records yet",
    refreshTaskList: "Refresh",
    refreshTaskListLoading: "Refreshing...",
    // 诊断结果管理相关
    diagnosticResultManagement: "Diagnostic Results Management",
    diagnosticResultManagementDesc: "View and manage historical diagnostic results",
    noDiagnosticResults: "No diagnostic results yet",
    refreshResults: "Refresh",
    refreshResultsLoading: "Refreshing...",
    deleteSelected: "Delete Selected",
    exportSelected: "Export Selected",
    // DCGM诊断级别说明
    dcgmLevelDescription: "DCGM Diagnostic Level Details:",
    dcgmDiagnosticLevel: "DCGM Diagnostic Level",
    level1: "Level 1",
    level2: "Level 2", 
    level3: "Level 3",
    level4: "Level 4",
    level1Desc: "Quick check (seconds)",
    level2Desc: "Standard check (<2 minutes)",
    level3Desc: "Detailed check (<30 minutes)",
    level4Desc: "Comprehensive check (1-2 hours)",
    // 表头翻译
    jobId: "Job ID",
    status: "Status",
    node: "Node",
    testItems: "Test Items",
    dcgmLevel: "DCGM Level",
    creationTime: "Creation Time",
    operation: "Operation",
    // 按钮翻译
    stop: "Stop",
    delete: "Delete",
    // 诊断结果相关
    diagnosticResults: "Diagnostic Results",
    diagnosticResultDetails: "Diagnostic Result Details",
    diagnosticResultDetailsDesc: "View detailed diagnostic result information and execution logs",
    diagnosticTime: "Diagnostic Time",
    diagnosticComplete: "Diagnostic Complete",
    // Export related
    basicInfo: "Basic Information",
    nodeName: "Node Name",
    gpuType: "GPU Type",
    jobId: "Job ID",
    dcgmDiagnosticLevel: "DCGM Diagnostic Level",
    completionTime: "Completion Time",
    overallResult: "Overall Result",
    performanceTest: "Performance Test",
    healthCheck: "Health Check",
    testResults: "Test Results",
    executionLog: "Execution Log",
    pass: "Pass",
    noPass: "No Pass",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    close: "Close",
    basicInfo: "Basic Information",
    node: "Node",
    testResults: "Test Results",
    overallResult: "Overall Result",
    performanceTest: "Performance Test",
    healthCheck: "Health Check",
    detailedTestResults: "Detailed Test Results",
    testItems: "Test Items",
    creationTime: "Creation Time",
    // Pagination related
    items: "items",
    noRecords: "No records",
    completionTime: "Completion Time",
    display: "Display",
    total: "Total",
    noMatchingHostname: "No matching hostname found",
    gpuNodeStatus: "GPU Node Status",
    gpuNodeStatusDesc: "GPU Node Resource Status",
    lastRefresh: "Last Refresh",
    neverRefreshed: "Never Refreshed",
    realTimeData: "Real-time Data",
    mockData: "Mock Data",
    refreshable: "Refreshable",
    waiting: "Waiting",
    cooling: "Cooling",
    autoRefresh: "Auto Refresh",
    on: "On",
    off: "Off",
    refreshing: "Refreshing...",
    refreshCountdown: "Waiting...",
    refreshCooldown: "Cooling...",
    refreshAttempts: "Attempts",
    nextRefreshTime: "Next Refresh Time",
    pageInitialized: "Page initialized, please click Refresh button to get latest data",
    errorInfo: "Error Information",
  },
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

// gpuBenchmarks 用 useState，确保 window.GPU_BENCHMARKS 变更后能实时生效

// 示例数据 - 作为fallback使用
const mockData = [
  {
    hostname: "gpu-node-001",
    gpuType: "H200",
    nvbandwidthTest: "54.9 GB/s",
    p2pBandwidthLatencyTest: "736.40 GB/s",
    ncclTests: "150.946 GB/s",
    dcgmDiag: "Pass",
    ibCheck: "Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试完成: 54.9 GB/s\n2024-01-15 02:00:10 - P2P测试完成: 736.40 GB/s\n2024-01-15 02:00:15 - NCCL测试完成: 150.946 GB/s\n2024-01-15 02:00:20 - DCGM诊断完成: Pass\n2024-01-15 02:00:25 - IB检查完成: Pass\n2024-01-15 02:00:30 - 所有检查项目完成，结果: Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
  {
    hostname: "gpu-node-002",
    gpuType: "H200",
    nvbandwidthTest: "54.7 GB/s",
    p2pBandwidthLatencyTest: "728.32 GB/s",
    ncclTests: "148.732 GB/s",
    dcgmDiag: "Pass",
    ibCheck: "Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试完成: 54.7 GB/s\n2024-01-15 02:00:10 - P2P测试完成: 728.32 GB/s\n2024-01-15 02:00:15 - NCCL测试完成: 148.732 GB/s\n2024-01-15 02:00:20 - DCGM诊断完成: Pass\n2024-01-15 02:00:25 - IB检查完成: Pass\n2024-01-15 02:00:30 - 所有检查项目完成，结果: Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
  {
    hostname: "gpu-node-003",
    gpuType: "H100",
    nvbandwidthTest: "28.3 GB/s",
    p2pBandwidthLatencyTest: "425.80 GB/s",
    ncclTests: "65.234 GB/s",
    dcgmDiag: "No Pass",
    ibCheck: "No Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试完成: 28.3 GB/s (未达标)\n2024-01-15 02:00:10 - P2P测试完成: 425.80 GB/s (未达标)\n2024-01-15 02:00:15 - NCCL测试完成: 65.234 GB/s (未达标)\n2024-01-15 02:00:20 - DCGM诊断完成: No Pass\n2024-01-15 02:00:25 - IB检查完成: No Pass\n2024-01-15 02:00:30 - 检查完成，结果: No Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
  {
    hostname: "gpu-node-004",
    gpuType: "A100",
    nvbandwidthTest: "55.1 GB/s",
    p2pBandwidthLatencyTest: "418.60 GB/s",
    ncclTests: "152.108 GB/s",
    dcgmDiag: "Pass",
    ibCheck: "Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试完成: 55.1 GB/s\n2024-01-15 02:00:10 - P2P测试完成: 418.60 GB/s\n2024-01-15 02:00:15 - NCCL测试完成: 152.108 GB/s\n2024-01-15 02:00:20 - DCGM诊断完成: Pass\n2024-01-15 02:00:25 - IB检查完成: Pass\n2024-01-15 02:00:30 - 所有检查项目完成，结果: Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
  {
    hostname: "gpu-node-005",
    gpuType: "H800",
    nvbandwidthTest: "0 GB/s",
    p2pBandwidthLatencyTest: "0 GB/s",
    ncclTests: "0 GB/s",
    dcgmDiag: "No Pass",
    ibCheck: "No Pass",
    executionLog:
      "2024-01-15 02:00:00 - GPU检查作业开始执行\n2024-01-15 02:00:05 - 带宽测试失败: 0 GB/s\n2024-01-15 02:00:10 - P2P测试失败: 0 GB/s\n2024-01-15 02:00:15 - NCCL测试失败: 0 GB/s\n2024-01-15 02:00:20 - DCGM诊断失败: No Pass\n2024-01-15 02:00:25 - IB检查失败: No Pass\n2024-01-15 02:00:30 - 检查完成，结果: No Pass",
    executionTime: "2024-01-15T02:00:00Z",
  },
]

export default function GhxDashboard() {
  const [language, setLanguage] = useState<"zh" | "en">("zh")
  const [currentPage, setCurrentPage] = useState("dashboard")

  // 获取当前语言的文本
  const t = i18n[language]


  // 语言切换处理
  const toggleLanguage = () => {
    const newLanguage = language === "zh" ? "en" : "zh"
    setLanguage(newLanguage)
    // 保存到localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem("language", newLanguage)
    }
  }

  // 页面切换处理
  const handlePageChange = (page: string) => {
    setCurrentPage(page)
    // 保存到localStorage
    if (typeof window !== "undefined") {
      localStorage.setItem("currentPage", page)
      // 同时更新URL参数，防止Ctrl+F5清除缓存后丢失状态
      const url = new URL(window.location.href)
      url.searchParams.set('page', page)
      window.history.replaceState({}, '', url.toString())
    }
  }

  // 初始化语言和页面状态
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedLanguage = localStorage.getItem("language") as "zh" | "en"
      
      // 优先从URL参数获取页面状态，防止Ctrl+F5清除缓存后丢失状态
      const urlParams = new URLSearchParams(window.location.search)
      const urlPage = urlParams.get('page')
      const savedPage = localStorage.getItem("currentPage") as string
      
      // 确定要使用的页面状态：URL参数 > localStorage > 默认值
      let targetPage = "dashboard" // 默认值
      if (urlPage && (urlPage === "dashboard" || urlPage === "troubleshooting")) {
        targetPage = urlPage
      } else if (savedPage && (savedPage === "dashboard" || savedPage === "troubleshooting")) {
        targetPage = savedPage
      }

      if (savedLanguage) {
        setLanguage(savedLanguage)
      }
      
      // 设置页面状态
      setCurrentPage(targetPage)
      
      // 如果URL参数存在，确保localStorage也同步更新
      if (urlPage && (urlPage === "dashboard" || urlPage === "troubleshooting")) {
        localStorage.setItem("currentPage", urlPage)
      }
    }
  }, [])

  // 渲染页面内容
  const renderPageContent = () => {
    switch (currentPage) {
      case "dashboard":
        return <DashboardContent language={language} t={t} />
      case "troubleshooting":
        return <TroubleshootingPage language={language} t={t} />
      case "burn-in":
        return <BurnInPage language={language} t={t} />
      default:
        return <DashboardContent language={language} t={t} />
    }
  }

  return (
    <DashboardLayout
      currentPage={currentPage}
      onPageChange={handlePageChange}
      language={language}
      onLanguageToggle={toggleLanguage}
      t={t}
    >
      {renderPageContent()}
    </DashboardLayout>
  )
}
