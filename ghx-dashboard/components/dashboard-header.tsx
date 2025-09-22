"use client"
import { Button } from "@/components/ui/button"
import { Globe, ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface DashboardHeaderProps {
  language: "zh" | "en"
  onLanguageToggle: () => void
  t: any // i18n text object
}

export function DashboardHeader({ language, onLanguageToggle, t }: DashboardHeaderProps) {
  return (
    <div className="sticky top-0 z-50 border-b border-border/50 transition-colors duration-200 bg-card/80 backdrop-blur-tech">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-3">
            {/* GHealthX Logo */}
            <div className="relative">
              <img
                src="/logo.png"
                alt="GHealthX Logo"
                width="48"
                height="48"
                className="object-contain animate-glow"
                style={{
                  filter: 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.3))',
                }}
              />
            </div>

            <div>
              <div className="flex items-center space-x-1">
                <h1 className="text-2xl font-bold text-foreground">
                  <span className="text-tech-blue">G</span>Health
                  <span className="text-tech-green">X</span>
                </h1>
                <span className="text-xs px-2 py-1 rounded-full font-medium bg-tech-blue/20 text-tech-blue border border-tech-blue/30">
                  GPU Health eXpert
                </span>
              </div>
              <p className="text-sm mt-1 text-muted-foreground font-mono">{t.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="tech-button border-tech-blue/50 hover:bg-tech-blue/20 hover:border-tech-blue"
                >
                  <Globe className="w-4 h-4 mr-2" />
                  <span className="font-mono">
                    {language === "zh" ? "中文" : "English"}
                  </span>
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="tech-card bg-gradient-to-br from-secondary/20 to-secondary/10 border-border/50 shadow-glow backdrop-blur-tech">
                <DropdownMenuItem
                  onClick={() => language !== "zh" && onLanguageToggle()}
                  className={`cursor-pointer transition-all duration-300 ${
                    language === "zh" 
                      ? "bg-tech-blue/20 text-tech-blue font-semibold" 
                      : "text-foreground hover:bg-tech-blue/10 hover:text-tech-blue"
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🇨🇳</span>
                    <span className="font-mono">中文</span>
                    {language === "zh" && <span className="text-tech-blue">✓</span>}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => language !== "en" && onLanguageToggle()}
                  className={`cursor-pointer transition-all duration-300 ${
                    language === "en" 
                      ? "bg-tech-blue/20 text-tech-blue font-semibold" 
                      : "text-foreground hover:bg-tech-blue/10 hover:text-tech-blue"
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🇺🇸</span>
                    <span className="font-mono">English</span>
                    {language === "en" && <span className="text-tech-blue">✓</span>}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
