import { LoadingShimmer } from "./LoadingShimmer";

export function PageSkeleton() {
  return (
    <main className="flex h-full w-full items-center justify-center bg-background">
      <LoadingShimmer />
    </main>
  );
}
