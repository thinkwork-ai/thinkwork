import { Skeleton } from "@thinkwork/ui";

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
