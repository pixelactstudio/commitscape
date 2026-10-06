import { CalendarDays, Eraser, Footprints, Hammer, Languages, MessageSquareText, Moon, Siren, type LucideIcon } from "lucide-react";
import type { ArchetypeId } from "@commitscape/data";

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
