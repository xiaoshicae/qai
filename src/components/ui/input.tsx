import * as React from "react"
import { cn } from "@/lib/utils"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-form-type="other"
        className={cn(
          "h-9 w-full min-w-0 rounded-xl border border-overlay/[0.08] bg-overlay/[0.03] px-3 py-1.5 text-sm transition-all duration-200 outline-none placeholder:text-muted-foreground/60 hover:border-overlay/[0.12] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:bg-overlay/[0.04] disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
          error && "border-destructive/50 focus-visible:border-destructive/50 focus-visible:ring-destructive/20",
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
