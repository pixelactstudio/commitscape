import { useEffect, useRef, useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Check, Copy } from "lucide-react";
import { ICON } from "../design/tokens";

function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (ok) resolve();
    else reject(new Error("Copying is not allowed here."));
  });
}

/** A button that copies a text and says so, to a screen reader too. */
export function CopyButton({ text, label, variant = "ghost" }: { text: string; label: string; variant?: "ghost" | "secondary" }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const press = () => {
    copyText(text).then(
      () => setState("done"),
      () => setState("failed"),
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <IconButton label={state === "done" ? "Copied" : label} tooltip={state === "failed" ? "Select the text and copy it yourself" : state === "done" ? "Copied" : label} variant={variant} size="sm" icon={state === "done" ? <Check size={ICON.sm} aria-hidden /> : <Copy size={ICON.sm} aria-hidden />} onClick={press} />
      <span role="status" className="sr-only">
        {state === "done" ? "Copied to the clipboard" : state === "failed" ? "Could not copy: select the text and copy it yourself" : ""}
      </span>
    </>
  );
}
