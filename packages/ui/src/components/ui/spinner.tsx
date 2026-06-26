import type * as React from "react"
import { cn } from "../../lib/utils.js"
import { Loader2Icon } from "lucide-react"

type SpinnerProps = Omit<React.ComponentPropsWithoutRef<"svg">, "ref">

const StatusIcon = Loader2Icon as unknown as React.ComponentType<
  SpinnerProps & {
    className?: string
    role?: string
    "aria-label"?: string
  }
>

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <StatusIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
