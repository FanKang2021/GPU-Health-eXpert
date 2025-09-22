"use client"

import type React from "react"
import { SidebarNavigation } from "@/components/sidebar-navigation"
import { DashboardHeader } from "@/components/dashboard-header"

interface DashboardLayoutProps {
  children?: React.ReactNode
  currentPage: string
  onPageChange: (page: string) => void
  language: "zh" | "en"
  onLanguageToggle: () => void
  t: any
}

export function DashboardLayout({
  children,
  currentPage,
  onPageChange,
  language,
  onLanguageToggle,
  t,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground font-tech">
      {/* 科技感背景网格 */}
      <div className="fixed inset-0 bg-tech-grid bg-[size:50px_50px] opacity-20 pointer-events-none" />
      
            {/* Header */}
            <DashboardHeader
              language={language}
              onLanguageToggle={onLanguageToggle}
              t={t}
            />

      {/* Main Layout with Sidebar */}
      <div className="flex h-[calc(100vh-64px)] relative">
        {/* Sidebar */}
        <div className="flex-shrink-0 z-10">
            <SidebarNavigation language={language} currentPage={currentPage} onPageChange={onPageChange} />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto relative">
          <div className="container mx-auto px-6 py-8 space-y-8 max-w-none">
            <div className="animate-slide-in">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
