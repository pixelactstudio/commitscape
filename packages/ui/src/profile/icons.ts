import { CalendarDays, Eraser, Footprints, Hammer, Languages, MessageSquareText, Moon, Siren, type LucideIcon } from "lucide-react";
import type { ArchetypeId } from "@commitscape/data";
import type { MeshPalette } from "../motion/mesh";

/** The icon that stands for each Archetype. */
export const ARCHETYPE_ICONS: Record<ArchetypeId, LucideIcon> = {
  reviewer: MessageSquareText,
  janitor: Eraser,
  firefighter: Siren,
  "night-owl": Moon,
  polyglot: Languages,
  weekend: CalendarDays,
  marathoner: Footprints,
  builder: Hammer,
};

/** The colours each Archetype's stage flows through: a dark base and three lights. */
export const ARCHETYPE_PALETTES: Record<ArchetypeId | "none", MeshPalette> = {
  reviewer: ["#0b0816", "#6d28d9", "#9d174d", "#4f46e5"],
  janitor: ["#06130f", "#0f766e", "#10b981", "#65a30d"],
  firefighter: ["#150907", "#b91c1c", "#ea580c", "#ca8a04"],
  "night-owl": ["#050816", "#1d4ed8", "#0e7490", "#ca8a04"],
  polyglot: ["#0b0912", "#be185d", "#2563eb", "#059669"],
  weekend: ["#13090f", "#be123c", "#d97706", "#7c3aed"],
  marathoner: ["#05110a", "#15803d", "#16a34a", "#0369a1"],
  builder: ["#0e0c07", "#a16207", "#15803d", "#0e7490"],
  none: ["#0b0d10", "#334155", "#1f6f43", "#475569"],
};
