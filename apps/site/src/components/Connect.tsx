import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { useRouteContext } from "@tanstack/react-router";
import { signIn } from "#/lib/auth-client";

export function Connect() {
  const [open, setOpen] = useState(false);
  const { user } = useRouteContext({ from: "__root__" });
  return (
    <>
      <Button label="Share from your terminal" variant="secondary" size="sm" onClick={() => setOpen(true)} />
      {user ? (
        <Button label={`Your repositories (${user.login})`} variant="ghost" size="sm" href="/me" />
      ) : (
        <Button label="Sign in with GitHub" variant="ghost" size="sm" onClick={() => signIn()} />
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
