"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Home, Wrench, ChevronLeft, ChevronRight, Monitor, Settings, Flame } from "lucide-react"

interface SidebarNavigationProps {
  language: "zh" | "en"
  currentPage: string
  onPageChange: (page: string) => void
}

const navigationItems = {
  zh: [
    { id: "dashboard", label: "主页", icon: Home, description: "GPU节点检查概览" },
    { id: "troubleshooting", label: "自检专区", icon: Wrench, description: "节点诊断和故障排查" },
    { id: "burn-in", label: "烧机专区", icon: Flame, description: "GPU烧机测试和实时监控" },
  ],
  en: [
    { id: "dashboard", label: "Dashboard", icon: Home, description: "GPU Node Inspection Overview" },
    {
      id: "troubleshooting",
      label: "Self-Inspection",
      icon: Wrench,
      description: "Node Diagnosis & Troubleshooting",
    },
    { id: "burn-in", label: "Burn-in Test", icon: Flame, description: "GPU Burn-in & Monitoring" },
  ],
}

export function SidebarNavigation({ language, currentPage, onPageChange }: SidebarNavigationProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const items = navigationItems[language]

  return (
    <Card className="tech-card h-full transition-all duration-300 ease-in-out border-r backdrop-blur-tech">
      {/* Header with collapse toggle */}
      <div className="relative p-4 border-b border-border/50 overflow-hidden">
        {/* 动态背景装饰 */}
        <div className="absolute inset-0 bg-gradient-to-br from-tech-blue/5 via-tech-purple/5 to-tech-cyan/5 animate-background-shift" />
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-tech-blue/10 to-transparent rounded-full blur-xl animate-float" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-tech-purple/10 to-transparent rounded-full blur-lg animate-float" style={{ animationDelay: '1s' }} />
        
        {/* 数据流效果 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-tech-blue/30 to-transparent animate-shimmer" />
          <div className="absolute top-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-tech-purple/20 to-transparent animate-shimmer" style={{ animationDelay: '0.5s' }} />
        </div>
        
        <div className="relative flex items-center justify-between">
          {!isCollapsed ? (
            <div className="flex items-center space-x-4">
              {/* 图标区域 - 超强动效设计 */}
              <div className="relative group cursor-pointer">
                {/* 外层旋转光环 */}
                <div className="absolute -inset-3 bg-gradient-to-r from-tech-blue/20 via-tech-purple/20 to-tech-cyan/20 rounded-full blur-sm group-hover:blur-md transition-all duration-500 animate-spin" style={{ animationDuration: '8s' }} />
                {/* 中层脉冲环 */}
                <div className="absolute -inset-2 bg-gradient-to-r from-tech-blue/30 to-tech-purple/30 rounded-full animate-pulse-slow" />
                {/* 内层图标容器 */}
                <div className="relative p-3 bg-gradient-to-br from-tech-blue/20 to-tech-purple/20 rounded-xl backdrop-blur-sm border border-tech-blue/30 group-hover:scale-110 transition-all duration-300">
                  <Monitor className="w-7 h-7 text-tech-blue animate-glow group-hover:animate-bounce" />
                  {/* 动态装饰点 */}
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-tech-green rounded-full animate-pulse shadow-glow-green" />
                  <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-tech-yellow rounded-full animate-pulse shadow-glow" style={{ animationDelay: '0.5s' }} />
                  <div className="absolute top-0 left-0 w-1.5 h-1.5 bg-tech-red rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
                </div>
                {/* 扫描线效果 */}
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-tech-blue/40 to-transparent animate-shimmer opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
              
              {/* 文字区域 - 超强动效设计 */}
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <h2 className="font-bold text-2xl bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent animate-pulse">
                    GHealthX
                  </h2>
                  {/* 动态状态指示器 */}
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }} />
                  </div>
                </div>
                
                <div className="flex items-center space-x-3">
                  <p className="text-sm text-cyan-400 font-mono tracking-wide animate-pulse">
                    GPU Health Expert
                  </p>
                  {/* 动态Live指示器 - 绿色圆点动效在LIVE前 */}
                  <div className="flex items-center space-x-2 px-2 py-1 bg-green-500/20 rounded-full border border-green-500/30">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-green-500 font-mono animate-pulse">LIVE</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* 折叠状态下的超强动效图标 */
            <div className="flex items-center justify-center">
              <div className="relative group cursor-pointer">
                {/* 外层旋转光环 */}
                <div className="absolute -inset-3 bg-gradient-to-r from-tech-blue/20 via-tech-purple/20 to-tech-cyan/20 rounded-full blur-sm group-hover:blur-md transition-all duration-500 animate-spin" style={{ animationDuration: '8s' }} />
                {/* 中层脉冲环 */}
                <div className="absolute -inset-2 bg-gradient-to-r from-tech-blue/30 to-tech-purple/30 rounded-full animate-pulse-slow" />
                {/* 内层图标容器 */}
                <div className="relative p-3 bg-gradient-to-br from-tech-blue/20 to-tech-purple/20 rounded-xl backdrop-blur-sm border border-tech-blue/30 group-hover:scale-110 transition-all duration-300">
                  <Monitor className="w-7 h-7 text-tech-blue animate-glow group-hover:animate-bounce" />
                  {/* 动态装饰点 */}
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-tech-green rounded-full animate-pulse shadow-glow-green" />
                  <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-tech-yellow rounded-full animate-pulse shadow-glow" style={{ animationDelay: '0.5s' }} />
                  <div className="absolute top-0 left-0 w-1.5 h-1.5 bg-tech-red rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
                </div>
                {/* 扫描线效果 */}
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-tech-blue/40 to-transparent animate-shimmer opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>
            </div>
          )}

          {/* 折叠按钮 - 超强动效设计 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="relative tech-button p-3 rounded-lg hover:bg-gradient-to-r hover:from-tech-blue/20 hover:to-tech-purple/20 transition-all duration-300 group hover:scale-110"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-tech-blue/10 to-tech-purple/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-tech-blue/20 to-transparent animate-shimmer opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="relative">
              {isCollapsed ? (
                <ChevronRight className="w-5 h-5 text-tech-blue group-hover:text-tech-purple transition-colors animate-pulse" />
              ) : (
                <ChevronLeft className="w-5 h-5 text-tech-blue group-hover:text-tech-purple transition-colors animate-pulse" />
              )}
            </div>
          </Button>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="p-3 space-y-2">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id

          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onPageChange(item.id)}
              className={`
                w-full justify-start transition-all duration-300 group relative overflow-hidden
                ${isCollapsed ? "px-3 py-3" : "px-4 py-3"}
                ${
                  isActive
                    ? "bg-gradient-primary text-primary-foreground shadow-glow"
                    : "text-foreground hover:bg-secondary/50 hover:text-secondary-foreground"
                }
              `}
            >
              {/* 科技感光效 */}
              {isActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
              )}
              
              <Icon className={`w-5 h-5 ${isCollapsed ? "" : "mr-3"} flex-shrink-0 transition-transform group-hover:scale-110`} />
              {!isCollapsed && (
                <div className="flex flex-col items-start">
                  <span className="font-semibold text-sm">{item.label}</span>
                  <span className="text-xs opacity-80 leading-tight">
                    {item.description}
                  </span>
                </div>
              )}
            </Button>
          )
        })}
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="absolute bottom-4 left-4 right-4 text-xs text-muted-foreground">
          <div className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 backdrop-blur-sm border border-border/50">
            <div className="flex items-center space-x-2">
              <Settings className="w-3 h-3 text-tech-blue animate-pulse" />
              <span className="font-mono text-foreground">System Status</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-1.5 h-1.5 bg-tech-green rounded-full animate-pulse" />
              <span className="font-mono text-tech-green">v1.2.3</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
