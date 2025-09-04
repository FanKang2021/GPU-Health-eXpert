"use client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface SummaryData {
  totalNodes: number
  passedNodes: number
  failedNodes: number
  lastUpdated: string | null
}

interface SummaryCardsProps {
  summary: SummaryData
  theme: "light" | "dark"
  t: any // i18n text object
}

export function SummaryCards({ summary, theme, t }: SummaryCardsProps) {
  // 格式化最后更新时间
  const formatLastUpdated = (timestamp: string | null) => {
    if (!timestamp) return "未知"
    return new Date(timestamp).toLocaleString("zh-CN")
  }

  return (
    <Card
      className={`mb-6 transition-colors duration-200 ${
        theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
      }`}
    >
      <CardHeader>
        <CardTitle className={`text-xl ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{t.summary}</CardTitle>
        <CardDescription className={theme === "dark" ? "text-gray-300" : "text-gray-600"}>
          {t.summaryDesc}
        </CardDescription>
        {summary.lastUpdated && (
          <p className={`text-sm mt-2 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
            {t.lastUpdated}: {formatLastUpdated(summary.lastUpdated)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className={`text-3xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
              {summary.totalNodes}
            </div>
            <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{t.totalNodes}</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{summary.passedNodes}</div>
            <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{t.passedNodes}</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600">{summary.failedNodes}</div>
            <div className={`text-sm ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{t.failedNodes}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
