"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-2 border-tech-blue/80 bg-white/10 dark:bg-white/20 data-[state=checked]:bg-tech-blue data-[state=checked]:text-white data-[state=checked]:border-tech-blue dark:data-[state=checked]:bg-tech-blue focus-visible:border-tech-blue focus-visible:ring-tech-blue/50 aria-invalid:ring-tech-red/20 dark:aria-invalid:ring-tech-red/40 aria-invalid:border-tech-red size-6 shrink-0 rounded-lg shadow-lg transition-all duration-300 outline-none focus-visible:ring-4 hover:border-tech-blue hover:shadow-glow hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-all duration-300"
      >
        <CheckIcon className="size-5 font-bold drop-shadow-lg" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
