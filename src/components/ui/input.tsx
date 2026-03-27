import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "h-9 w-full min-w-0 rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 py-1.5 text-sm transition-all duration-200 outline-none placeholder:text-muted-foreground/60 hover:border-overlay/[0.12] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:bg-overlay/[0.04] disabled:pointer-events-none disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
