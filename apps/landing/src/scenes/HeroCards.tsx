import { AtSign, BriefcaseBusiness, FileText } from "lucide-react";
import { ICON } from "@commitscape/ui/design";
import { Chip } from "@commitscape/ui/kit/primitives";
import { ThemedCard } from "../page/ThemedCard";
import { HERO_CARDS } from "./hero";

const ICONS = [FileText, BriefcaseBusiness, AtSign];

/**
 * Real Cards made for gaearon, leaning toward the pointer. One at a time is drawn out of the deck, clear of the cards
 * above it, laid back on top and says where it goes; then it slides out again and back into its place.
 */
export function HeroCards() {
  return (
    <div data-hero-box className="relative mx-auto w-full max-w-136">
      <div data-scene="hero" className="hero-cards relative aspect-[1.02] w-full" role="group" aria-label="Cards made for gaearon">
        {HERO_CARDS.map((c, i) => {
          const Glyph = ICONS[i] ?? FileText;
          return (
            <div key={c.src} data-hero-slot className={`rise absolute ${c.place}`} style={{ zIndex: i + 1, animationDelay: `${(i + 2) * 60}ms` }}>
              <div data-hero-layer data-depth={c.depth}>
                <div data-hero-card className="hero-card relative" style={{ transform: `rotate(${c.turn}deg)` }}>
                  <ThemedCard src={c.src} alt={c.alt} width={c.width} height={c.height} eager />
                  <span data-hero-chip aria-hidden className={`hero-chip absolute ${c.chipPlace}`}>
                    <Chip icon={<Glyph size={ICON.xs} className="text-brand" />} className="shadow-md">
                      {c.chip}
                    </Chip>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
