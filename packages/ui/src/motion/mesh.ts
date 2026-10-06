export type MeshPalette = readonly [base: string, first: string, second: string, third: string];

/** The CSS stand-in for a palette, shown until the shader draws and wherever WebGL is missing. */
export function meshFallback([base, first, second, third]: MeshPalette): string {
  return `radial-gradient(90% 75% at 100% 0%, ${first}cc, transparent 62%), radial-gradient(95% 85% at 0% 100%, ${second}b3, transparent 62%), radial-gradient(55% 45% at 85% 100%, ${third}80, transparent 70%), ${base}`;
}
