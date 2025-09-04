"use client"

import type React from "react"
import { SidebarNavigation } from "@/components/sidebar-navigation"
import { DashboardHeader } from "@/components/dashboard-header"

interface DashboardLayoutProps {
  children?: React.ReactNode
  currentPage: string
  onPageChange: (page: string) => void
  theme: "light" | "dark"
  language: "zh" | "en"
  onThemeToggle: () => void
  onLanguageToggle: () => void
  t: any
}

export function DashboardLayout({
  children,
  currentPage,
  onPageChange,
  theme,
  language,
  onThemeToggle,
  onLanguageToggle,
  t,
}: DashboardLayoutProps) {
  return (
    <div className={`min-h-screen transition-colors duration-200 ${theme === "dark" ? "bg-gray-900" : "bg-gray-50"}`}>
      {/* Header */}
      <DashboardHeader
        theme={theme}
        language={language}
        onThemeToggle={onThemeToggle}
        onLanguageToggle={onLanguageToggle}
        t={t}
      />

      {/* Main Layout with Sidebar */}
      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar */}
        <div className="flex-shrink-0">
          <SidebarNavigation theme={theme} language={language} currentPage={currentPage} onPageChange={onPageChange} />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="container mx-auto px-4 py-6 space-y-6 max-w-none">{children}</div>
        </div>
      </div>
    </div>
  )
}
