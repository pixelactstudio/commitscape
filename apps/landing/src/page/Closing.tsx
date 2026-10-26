import { Logo } from "@commitscape/ui/components/Logo";
import { STAGGER } from "@commitscape/ui/motion/constants";
import { Band } from "./layout";
import { Lookup } from "./Lookup";
import { Reveal } from "./Reveal";

/** The last call on the page: the lookup again, under a quiet glow. */
export function Closing() {
  return (
    <Band label="Look yourself up" className="closing overflow-hidden">
      <div className="relative mx-auto flex max-w-xl flex-col items-center gap-6 px-5 py-20 text-center sm:py-band">
        <Reveal blur={false} className="closing-mark flex size-14 items-center justify-center rounded-xl border border-line bg-surface">
          <Logo size={28} />
        </Reveal>
        <Reveal as="h2" delay={STAGGER.base} className="m-0 type-display">
          Your turn.
        </Reveal>
        <Reveal as="p" delay={STAGGER.loose} className="m-0 type-lead">
          Type your GitHub username and sign in: your Profile is read from GitHub at once.
        </Reveal>
        <div className="w-full text-start">
          <Lookup label="Show me mine" />
        </div>
      </div>
    </Band>
  );
}
