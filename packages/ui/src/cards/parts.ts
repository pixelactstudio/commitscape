import { alpha, mix, type Look } from "./style";

export const inner = (look: Look, less = 10) => (look.radius === 0 ? 0 : Math.max(6, look.radius - less));

export function glass(look: Look, lead = false) {
  const t = look.t;
  const dark = look.theme === "dark";
  if (lead) return { backgroundColor: alpha(mix(t.bg, t.accent, dark ? 0.16 : 0.1), look.background === "plain" ? 1 : 0.84), border: `1px solid ${alpha(t.accent, dark ? 0.4 : 0.32)}` };
  return { backgroundColor: look.background === "plain" ? t.surface : alpha(t.bg, dark ? 0.62 : 0.74), border: `1px solid ${alpha(t.text, dark ? 0.1 : 0.08)}` };
}

export const LANGUAGE_COLOURS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#663399",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00b4ab",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Scala: "#c22d40",
  Lua: "#000080",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  "Objective-C": "#438eff",
  OCaml: "#ef7a08",
  Clojure: "#db5855",
  "Jupyter Notebook": "#da5b0b",
  MDX: "#fcb32c",
};

export const STAR = "M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z";

export function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= most ? flat : `${flat.slice(0, most - 1).trimEnd()}…`;
}
