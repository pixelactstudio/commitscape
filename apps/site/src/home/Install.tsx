import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { Reveal, STAGGER } from "@commitscape/ui/motion";
import { Band } from "./layout";
import { TerminalScene } from "./scenes/TerminalScene";

const INSTALL: Record<string, { label: string; command: string; note: string }> = {
  npm: { label: "npm", command: "npx commitscape", note: "Or npm install -g commitscape." },
  brew: { label: "Homebrew", command: "brew install pixelactstudio/commitscape/commitscape", note: "Then run commitscape in any repository." },
  nix: { label: "Nix", command: "nix run github:pixelactstudio/commitscape", note: "No install; Nix builds and runs it." },
  share: { label: "Share", command: "npx commitscape share", note: "Prints a link only its holder can open. It expires within hours." },
};

/** The command line: how to install it, and a terminal showing a run and a shared link. */
export function Install() {
  const [tab, setTab] = useState("npm");
  const [copied, setCopied] = useState(false);
  const pick = INSTALL[tab] ?? INSTALL.npm;
  return (
    <Band label="The command line">
      <div className="grid items-center gap-12 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1.15fr] lg:py-28">
        <div className="flex min-w-0 flex-col gap-6">
          <Reveal blur={false} y={0}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--color-background-surface)] px-3 py-1 text-[0.78rem] font-medium text-secondary">
              <SquareTerminal size={13} className="text-brand" aria-hidden />
              Or keep it on your machine
            </span>
          </Reveal>
          <Reveal as="h2" delay={STAGGER.base} className="m-0 text-[clamp(1.85rem,4vw,2.9rem)] leading-[1.06] font-semibold tracking-[-0.04em] text-balance">
            The same numbers, from your terminal
          </Reveal>
          <Reveal as="p" delay={STAGGER.loose} className="m-0 max-w-lg text-[1.02rem] leading-relaxed text-pretty text-secondary">
            Run it in any git repository. Nothing leaves your machine, and a link shares a Report from a server without holding the terminal open.
          </Reveal>
          <Reveal delay={STAGGER.loose} className="flex max-w-lg flex-col gap-3">
            <SegmentedControl
              label="How to install"
              value={tab}
              onChange={(v) => {
                setTab(v);
                setCopied(false);
              }}
              size="sm"
            >
              {Object.entries(INSTALL).map(([k, v]) => (
                <SegmentedControlItem key={k} value={k} label={v.label} />
              ))}
            </SegmentedControl>
            <div className="flex items-center gap-3 rounded-[var(--radius-element)] border border-line bg-[var(--color-background-surface)] py-1.5 ps-4 pe-1.5 font-mono text-[0.86rem]">
              <span className="text-brand" aria-hidden>
                $
              </span>
              <code className="min-w-0 flex-1 truncate text-primary">{pick?.command}</code>
              <Button
                label={copied ? "Copied" : "Copy"}
                isIconOnly
                size="sm"
                variant="ghost"
                icon={<Icon icon={copied ? Check : Copy} size="sm" />}
                onClick={() => void navigator.clipboard?.writeText(pick?.command ?? "").then(() => setCopied(true))}
              />
            </div>
            <p className="m-0 text-sm text-secondary">{pick?.note}</p>
          </Reveal>
        </div>
        <div aria-hidden className="min-w-0">
          <TerminalScene />
        </div>
      </div>
    </Band>
  );
}
