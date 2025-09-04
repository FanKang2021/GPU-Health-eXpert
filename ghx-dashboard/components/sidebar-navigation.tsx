"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Home, Wrench, ChevronLeft, ChevronRight, Monitor, Settings } from "lucide-react"

interface SidebarNavigationProps {
  theme: "light" | "dark"
  language: "zh" | "en"
  currentPage: string
  onPageChange: (page: string) => void
}

const navigationItems = {
  zh: [
    { id: "dashboard", label: "主页", icon: Home, description: "GPU节点检查概览" },
    { id: "troubleshooting", label: "自检专区", icon: Wrench, description: "节点诊断和故障排查" },
  ],
  en: [
    { id: "dashboard", label: "Dashboard", icon: Home, description: "GPU Node Inspection Overview" },
    {
      id: "troubleshooting",
      label: "Self-Inspection",
      icon: Wrench,
      description: "Node Diagnosis & Troubleshooting",
    },
  ],
}

export function SidebarNavigation({ theme, language, currentPage, onPageChange }: SidebarNavigationProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const items = navigationItems[language]

  return (
    <Card
      className={`
      h-full transition-all duration-300 ease-in-out border-r
      ${isCollapsed ? "w-16" : "w-64"}
      ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}
    `}
    >
      {/* Header with collapse toggle */}
      <div
        className={`
        flex items-center justify-between p-4 border-b
        ${theme === "dark" ? "border-gray-700" : "border-gray-200"}
      `}
      >
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <Monitor className={`w-6 h-6 ${theme === "dark" ? "text-blue-400" : "text-blue-600"}`} />
            <h2 className={`font-semibold text-lg ${theme === "dark" ? "text-white" : "text-gray-900"}`}>GHealthX</h2>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`
            p-2 rounded-md transition-colors
            ${theme === "dark" ? "hover:bg-gray-700 text-gray-300 bg-gray-800" : "hover:bg-gray-100 text-gray-600 bg-white"}
          `}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation Items */}
      <nav className="p-2 space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id

          return (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onPageChange(item.id)}
              className={`
                w-full justify-start transition-all duration-200
                ${isCollapsed ? "px-2" : "px-3"}
                ${
                  isActive
                    ? theme === "dark"
                      ? "bg-blue-900/50 text-blue-300 hover:bg-blue-900/70"
                      : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    : theme === "dark"
                      ? "text-gray-300 hover:bg-gray-700 hover:text-white bg-gray-800"
                      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 bg-white"
                }
              `}
            >
              <Icon className={`w-5 h-5 ${isCollapsed ? "" : "mr-3"} flex-shrink-0`} />
              {!isCollapsed && (
                <div className="flex flex-col items-start">
                  <span className="font-medium">{item.label}</span>
                  <span
                    className={`text-xs ${
                      isActive
                        ? theme === "dark"
                          ? "text-blue-200"
                          : "text-blue-600"
                        : theme === "dark"
                          ? "text-gray-400"
                          : "text-gray-500"
                    }`}
                  >
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
        <div
          className={`
          absolute bottom-4 left-4 right-4 text-xs
          ${theme === "dark" ? "text-gray-400" : "text-gray-500"}
        `}
        >
          <div className="flex items-center space-x-1">
            <Settings className="w-3 h-3" />
            <span>GPU Health Expert</span>
          </div>
          <div className="mt-1">Version 1.0</div>
        </div>
      )}
    </Card>
  )
}
