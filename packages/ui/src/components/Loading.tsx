import { Skeleton } from "@astryxdesign/core/Skeleton";

export function ScreenSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-2" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={84} index={i} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton height={260} index={4} />
        <Skeleton height={260} index={5} />
      </div>
      <Skeleton height={180} index={6} />
    </div>
  );
}

export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "60%" : "100%"} radius={1} index={i} />
      ))}
    </div>
  );
}
