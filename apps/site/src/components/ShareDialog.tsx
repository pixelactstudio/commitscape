import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { useRouteContext } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { DEFAULT_STYLE } from "@commitscape/ui";
import { CardStudio, type CardChoice, type StudioState } from "#/components/CardStudio";

/** A Share button that opens the Card studio over the page, with the Cards this page can make. */
export function ShareButton({ choices, origin, label = "Share", title = "Share a Card", variant = "primary" }: { choices: CardChoice[]; origin: string; label?: string; title?: string; variant?: "primary" | "secondary" }) {
  const { mode } = useRouteContext({ from: "__root__" });
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<StudioState>({ card: choices[0]?.id ?? "", style: DEFAULT_STYLE, mode: mode === "light" ? "light" : "dark" });
  if (choices.length === 0) return null;
  return (
    <>
      <Button label={label} variant={variant} icon={<Icon icon={Share2} size="sm" />} onClick={() => setOpen(true)} />
      <Dialog isOpen={open} onOpenChange={setOpen} width="min(1180px, 96vw)" maxHeight="92dvh" padding={5}>
        <DialogHeader title={title} onOpenChange={setOpen} />
        <div className="pt-4">{open && <CardStudio choices={choices} state={state} onChange={setState} origin={origin} />}</div>
      </Dialog>
    </>
  );
}
