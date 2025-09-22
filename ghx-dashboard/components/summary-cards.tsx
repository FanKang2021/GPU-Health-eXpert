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
  t: any // i18n text object
}

export function SummaryCards({ summary, t }: SummaryCardsProps) {
  // 格式化最后更新时间
  const formatLastUpdated = (timestamp: string | null) => {
    if (!timestamp) return "未知"
    return new Date(timestamp).toLocaleString("zh-CN")
  }

  return (
    <Card className="tech-card mb-6 bg-gradient-to-br from-tech-blue/10 to-tech-cyan/10 border-tech-blue/30 shadow-glow">
      <CardHeader>
        <CardTitle className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">{t.summary}</CardTitle>
        <CardDescription className="text-muted-foreground font-mono">
          {t.summaryDesc}
        </CardDescription>
        {summary.lastUpdated && (
          <p className="text-sm mt-2 text-muted-foreground font-mono">
            {t.lastUpdated}: {formatLastUpdated(summary.lastUpdated)}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 rounded-lg bg-secondary/20 backdrop-blur-sm border border-border/50">
            <div className="text-3xl font-bold text-foreground">
              {summary.totalNodes}
            </div>
            <div className="text-sm text-muted-foreground font-mono">{t.totalNodes}</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-tech-green/10 backdrop-blur-sm border border-tech-green/30">
            <div className="text-3xl font-bold text-tech-green">{summary.passedNodes}</div>
            <div className="text-sm text-muted-foreground font-mono">{t.passedNodes}</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-tech-red/10 backdrop-blur-sm border border-tech-red/30">
            <div className="text-3xl font-bold text-tech-red">{summary.failedNodes}</div>
            <div className="text-sm text-muted-foreground font-mono">{t.failedNodes}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
