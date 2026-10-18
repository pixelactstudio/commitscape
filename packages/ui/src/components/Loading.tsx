import { Skeleton } from "@astryxdesign/core/Skeleton";

/** A few lines of text still being read, the last one shorter. */
export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "60%" : "100%"} radius={1} index={i} />
      ))}
    </div>
  );
}
