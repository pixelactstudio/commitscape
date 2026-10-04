/** Survival, as a share, only when both numbers are known and it is a share: an import left out of Lines Changed can make it pass 100%, and then it is not shown. */
export function survival(lines: number | null, added: number | null): string | null {
  if (lines === null || added === null || added === 0 || lines > added) return null;
  const p = (lines * 100) / added;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}
