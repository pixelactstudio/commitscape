/**
 * The Connect menu: share from a terminal, and sign in with GitHub
 * (ADR-0017), or, signed in, your repositories. Sharing needs no account:
 * `commitscape share` uploads an encrypted Report the Site cannot read
 * (ADR-0016).
 */
import { useState, useSyncExternalStore } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";

/** Who is signed in, from the readable cookie the Site sets beside the session (display only; the API trusts the session). */
function signedIn(): string | null {
  const m = /(?:^|;\s*)cs_login=([^;]+)/.exec(document.cookie);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export function Connect() {
  const [open, setOpen] = useState(false);
  const login = useSyncExternalStore(
    () => () => {},
    signedIn,
    () => null,
  );
  return (
    <>
      <Button label="Share from your terminal" variant="secondary" size="sm" onClick={() => setOpen(true)} />
      {login ? (
        <Button label={`Your repositories (${login})`} variant="ghost" size="sm" href="/me" />
      ) : (
        <Button label="Sign in with GitHub" variant="ghost" size="sm" href="/api/auth/github" />
      )}
      <Dialog isOpen={open} onOpenChange={setOpen} width={560}>
        <DialogHeader title="Share from your terminal" onOpenChange={setOpen} />
        <div className="dialog-body">
          <p>In any git repository, on any machine, a headless server too:</p>
          <pre className="command">npx commitscape share</pre>
          <p className="note">
            It reads the repository on your machine, locks the Report with a key that only the link it prints holds,
            uploads what the Site cannot read, and exits. The link works in any browser for 4 hours (up to 12 with
            --expires), and its page has a Delete button.
          </p>
        </div>
      </Dialog>
    </>
  );
}
