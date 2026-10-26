import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Check, Copy } from "lucide-react";

const INSTALL: Record<string, { label: string; command: string; note: string }> = {
  npm: { label: "npm", command: "npx commitscape", note: "It asks before it uploads. Or npm install -g commitscape." },
  brew: { label: "Homebrew", command: "brew install pixelactstudio/commitscape/commitscape", note: "Then run commitscape in any repository." },
  nix: { label: "Nix", command: "nix run github:pixelactstudio/commitscape", note: "No install; Nix builds and runs it." },
  report: { label: "File", command: "npx commitscape report", note: "Writes the Report to a file instead, and uploads nothing." },
};

const ignore = () => {};

/** One state of the install picker: the way chosen, its command and whether it was just copied. */
export function PickerView({ tab, copied }: { tab: string; copied: boolean }) {
  const pick = INSTALL[tab] ?? INSTALL.npm;
  return (
    <div className="flex max-w-lg flex-col gap-3">
      <SegmentedControl label="How to install" value={tab} onChange={ignore} size="sm">
        {Object.entries(INSTALL).map(([k, v]) => (
          <SegmentedControlItem key={k} value={k} label={v.label} />
        ))}
      </SegmentedControl>
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface py-1.5 ps-4 pe-1.5 font-mono text-sm">
        <span className="text-brand" aria-hidden>
          $
        </span>
        <code data-command className="min-w-0 flex-1 text-primary [overflow-wrap:anywhere]">
          {pick?.command}
        </code>
        <span data-copy className="contents">
          <Button label={copied ? "Copied" : "Copy"} isIconOnly size="sm" variant="ghost" icon={<Icon icon={copied ? Check : Copy} size="sm" />} />
        </span>
      </div>
      <p className="m-0 type-caption">{pick?.note}</p>
    </div>
  );
}

/** How to install the command line, one way at a time, with its command to copy: every state drawn on the server, so the page's script only swaps between them. */
export function InstallPicker() {
  const states = Object.keys(INSTALL).flatMap((tab) => [false, true].map((copied) => ({ key: `${tab}:${copied ? 1 : 0}`, html: renderToStaticMarkup(<PickerView tab={tab} copied={copied} />) })));
  return (
    <div data-install>
      <div data-install-view>
        <PickerView tab="npm" copied={false} />
      </div>
      {states.map((s) => (
        <template key={s.key} data-install-state={s.key} dangerouslySetInnerHTML={{ __html: s.html }} />
      ))}
    </div>
  );
}
