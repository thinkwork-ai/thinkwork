import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

interface PageSkeletonProps {
  className?: string;
}

export function PageSkeleton({
  className,
}: PageSkeletonProps) {
  return (
    <div className={cn("flex items-center justify-center py-24", className)}>
      <Spinner className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}
