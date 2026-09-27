/**
 * The local page's Share button (ADR-0016): the same as `commitscape
 * share`. It says what will be uploaded, asks once, and gives the link to
 * copy, which works in any browser for the hours chosen.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Selector } from "@astryxdesign/core/Selector";
import { useSource } from "../data";

const HOURS = [1, 2, 4, 8, 12];

export function Share() {
  const { share } = useSource();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("4");
  const [state, setState] = useState<{ kind: "ask" } | { kind: "busy" } | { kind: "done"; link: string } | { kind: "error"; words: string }>({ kind: "ask" });
  const [copied, setCopied] = useState(false);
  if (!share) return null;
  const go = async () => {
    setState({ kind: "busy" });
    try {
      const made = await share(Number(hours));
      setState({ kind: "done", link: made.link });
    } catch (e) {
      setState({ kind: "error", words: (e as Error).message });
    }
  };
  return (
    <>
      <Button label="Share" variant="secondary" size="sm" onClick={() => (setOpen(true), setState({ kind: "ask" }), setCopied(false))} />
      <Dialog isOpen={open} onOpenChange={setOpen} width={600}>
        <DialogHeader title="Share this Report" onOpenChange={setOpen} />
        <div className="dialog-body">
          {state.kind === "done" ? (
            <>
              <p>Anyone with this link can open the Report in any browser until it expires. Its page has a Delete button.</p>
              <pre className="share-link">{state.link}</pre>
              <Button
                label={copied ? "Copied" : "Copy the link"}
                variant="primary"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(state.link).then(() => setCopied(true))}
              />
            </>
          ) : (
            <>
              <p>
                This uploads the Report locked with a key only the link will hold: file paths, people's names and GitHub logins,
                and commit subject lines. No email addresses. The Site cannot read it.
              </p>
              <div className="actions">
                <Selector
                  label="The link works for"
                  size="sm"
                  value={hours}
                  onChange={(v) => setHours(v)}
                  options={HOURS.map((h) => ({ value: String(h), label: `${h} ${h === 1 ? "hour" : "hours"}` }))}
                  width={180}
                />
                <Button label={state.kind === "busy" ? "Uploading…" : "Upload"} variant="primary" size="sm" isDisabled={state.kind === "busy"} onClick={() => void go()} />
              </div>
              {state.kind === "error" && <p className="error">{state.words}</p>}
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
