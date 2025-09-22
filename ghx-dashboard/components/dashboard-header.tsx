"use client"
import { Button } from "@/components/ui/button"
import { Sun, Moon, Globe } from "lucide-react"

interface DashboardHeaderProps {
  theme: "light" | "dark"
  language: "zh" | "en"
  onThemeToggle: () => void
  onLanguageToggle: () => void
  t: any // i18n text object
}

export function DashboardHeader({ theme, language, onThemeToggle, onLanguageToggle, t }: DashboardHeaderProps) {
  return (
    <div
      className={`sticky top-0 z-50 border-b transition-colors duration-200 ${
        theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
      }`}
    >
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            {/* GPU芯片Logo */}
            <div className="relative">
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                className={`${theme === "dark" ? "text-blue-400" : "text-blue-600"}`}
                fill="currentColor"
              >
                {/* 外层芯片轮廓 */}
                <rect
                  x="4"
                  y="4"
                  width="32"
                  height="32"
                  rx="4"
                  fill="currentColor"
                  opacity="0.1"
                  stroke="currentColor"
                  strokeWidth="2"
                />

                {/* 内层核心 */}
                <rect x="8" y="8" width="24" height="24" rx="2" fill="currentColor" opacity="0.2" />

                {/* GPU核心网格 */}
                <g opacity="0.8">
                  <rect x="12" y="12" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="18" y="12" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="24" y="12" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="12" y="18" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="18" y="18" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="24" y="18" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="12" y="24" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="18" y="24" width="4" height="4" rx="0.5" fill="currentColor" />
                  <rect x="24" y="24" width="4" height="4" rx="0.5" fill="currentColor" />
                </g>

                {/* 连接引脚 */}
                <g opacity="0.6">
                  <rect x="0" y="14" width="4" height="2" fill="currentColor" />
                  <rect x="0" y="18" width="4" height="2" fill="currentColor" />
                  <rect x="0" y="22" width="4" height="2" fill="currentColor" />
                  <rect x="36" y="14" width="4" height="2" fill="currentColor" />
                  <rect x="36" y="18" width="4" height="2" fill="currentColor" />
                  <rect x="36" y="22" width="4" height="2" fill="currentColor" />
                  <rect x="14" y="0" width="2" height="4" fill="currentColor" />
                  <rect x="18" y="0" width="2" height="4" fill="currentColor" />
                  <rect x="22" y="0" width="2" height="4" fill="currentColor" />
                  <rect x="14" y="36" width="2" height="4" fill="currentColor" />
                  <rect x="18" y="36" width="2" height="4" fill="currentColor" />
                  <rect x="22" y="36" width="2" height="4" fill="currentColor" />
                </g>

                {/* 健康状态指示器 */}
                <circle cx="32" cy="8" r="3" fill="#10B981" opacity="0.9" />
                <circle cx="32" cy="8" r="1.5" fill="white" />
              </svg>
            </div>

            <div>
              <div className="flex items-center space-x-1">
                <h1 className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>
                  <span className={`${theme === "dark" ? "text-blue-400" : "text-blue-600"}`}>G</span>Health
                  <span className={`${theme === "dark" ? "text-green-400" : "text-green-600"}`}>X</span>
                </h1>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    theme === "dark"
                      ? "bg-blue-900 text-blue-300 border border-blue-700"
                      : "bg-blue-100 text-blue-700 border border-blue-200"
                  }`}
                >
                  GPU Health eXpert
                </span>
              </div>
              <p className={`text-sm mt-1 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{t.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onLanguageToggle}
              className={`${
                theme === "dark"
                  ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
              }`}
            >
              <Globe className="w-4 h-4 mr-1" />
              {language === "zh" ? "EN" : "中文"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onThemeToggle}
              className={`${
                theme === "dark"
                  ? "border-gray-600 text-white hover:bg-gray-700 bg-gray-800"
                  : "border-gray-300 text-gray-700 hover:bg-gray-100 bg-white"
              }`}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
