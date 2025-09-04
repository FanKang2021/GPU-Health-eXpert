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
          <div>
            <h1 className={`text-2xl font-bold ${theme === "dark" ? "text-white" : "text-gray-900"}`}>{t.title}</h1>
            <p className={`text-sm mt-1 ${theme === "dark" ? "text-gray-300" : "text-gray-600"}`}>{t.subtitle}</p>
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
