/** Numbers in the words the interface uses. */

/** 1234567 → "1,234,567". */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 1234 → "1.2k", 2500000 → "2.5M". */
export function compact(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
    }
  }
  return grouped(n);
}

/** A part of a whole as a whole percentage; "—" when there is no whole. */
export function share(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part * 100) / whole)}%`;
}

/** A day since the epoch as "12 Mar 2026". */
export function day(days: number): string {
  return new Date(days * 86_400_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
