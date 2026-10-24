import { Skeleton } from "@astryxdesign/core/Skeleton";

/** A number still being counted, as a shimmer in exactly its own slot. */
export function Counting({ width = 56, height = 14, index = 0, className = "" }: { width?: number | string; height?: number; index?: number; className?: string }) {
  return (
    <span role="img" aria-label="being counted" title="Being counted: a fresh read that counts every line is under way" className={`inline-flex align-middle ${className}`}>
      <Skeleton width={width} height={height} radius={1} index={index} />
    </span>
  );
}
