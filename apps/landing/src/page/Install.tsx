import { SquareTerminal } from "lucide-react";
import { STAGGER } from "@commitscape/ui/motion/constants";
import { TerminalScene } from "../scenes/TerminalScene";
import { InstallPicker } from "./InstallPicker";
import { Band, Kicker } from "./layout";
import { Reveal } from "./Reveal";

/** The command line: how to install it, and a terminal showing a run and a shared link. */
export function Install() {
  return (
    <Band label="The command line">
      <div className="grid items-center gap-12 px-(--gutter) py-20 sm:py-band lg:grid-cols-[1fr_1.15fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <Reveal blur={false} y={0}>
            <Kicker icon={SquareTerminal}>From your terminal</Kicker>
          </Reveal>
          <Reveal as="h2" delay={STAGGER.base} className="m-0 type-display">
            Any repository on your machine, one command
          </Reveal>
          <Reveal as="p" delay={STAGGER.loose} className="m-0 max-w-lg type-lead">
            Run it in any git repository. It asks first, then uploads a Report locked with a key only its link holds, and opens it in your browser. The link expires within hours.
          </Reveal>
          <Reveal delay={STAGGER.loose}>
            <InstallPicker />
          </Reveal>
        </div>
        <div aria-hidden className="min-w-0">
          <TerminalScene />
        </div>
      </div>
    </Band>
  );
}
