import { Logo } from "@commitscape/ui";
import { Reveal, STAGGER } from "@commitscape/ui/motion";
import { Lookup } from "#/components/Lookup";
import { Band } from "./layout";

/** The last call on the home page: the lookup again, under a quiet glow. */
export function Closing() {
  return (
    <Band label="Look yourself up" className="closing overflow-hidden">
      <div className="relative mx-auto flex max-w-xl flex-col items-center gap-6 px-5 py-24 text-center sm:py-32">
        <Reveal blur={false} className="closing-mark flex size-[56px] items-center justify-center rounded-[16px] border border-line bg-[var(--color-background-surface)]">
          <Logo size={28} />
        </Reveal>
        <Reveal as="h2" delay={STAGGER.base} className="m-0 text-[clamp(2rem,4.6vw,3.2rem)] leading-[1.04] font-semibold tracking-[-0.045em] text-balance">
          Your turn.
        </Reveal>
        <Reveal as="p" delay={STAGGER.loose} className="m-0 text-[1.02rem] text-pretty text-secondary">
          Type your GitHub username. Your Profile is read from GitHub at once.
        </Reveal>
        <div className="w-full text-start">
          <Lookup label="Show me mine" />
        </div>
      </div>
    </Band>
  );
}
