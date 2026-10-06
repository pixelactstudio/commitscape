import type { CardStyle } from "@commitscape/ui";

/** One Card someone can pick in the studio; its url and link are addresses on the Site, without the origin. */
export type CardChoice = { id: string; title: string; about: string; url: string; width: number; height: number; link: string; share: string; alt: string; group?: string };

export type StudioState = { card: string; style: CardStyle; mode: "light" | "dark" };
