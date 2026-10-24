const STEPS = [1, 2, 5, 10];

/** Round whole-number tick values from zero for an axis that must reach `most`: steps of 1, 2, 5 or 10 times a power of ten, the last tick at or above the data. */
export function niceTicks(most: number, count = 4): number[] {
  if (!(most > 0)) return [0, 1];
  const rough = most / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, Math.round((STEPS.find((s) => s * power >= rough) ?? 10) * power));
  const out: number[] = [];
  for (let v = 0; ; v += step) {
    out.push(v);
    if (v >= most) break;
  }
  return out;
}
