import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ArrowRight, Search } from "lucide-react";
import { SIGN_IN } from "../env";

export const WRONG = "Type a GitHub username, like gaearon, or a repository, like react/react.";

/** The large search box: a GitHub username or a repository, opened on the app. Without the page's script it goes to signing in. */
export function Lookup({ autoFocus = false, label = "Show me", placeholder = "GitHub username, or owner/repo" }: { autoFocus?: boolean; label?: string; placeholder?: string }) {
  return (
    <form data-lookup data-autofocus={autoFocus ? "" : undefined} action={SIGN_IN} method="get" noValidate className="flex w-full flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <TextInput label="A GitHub username or repository" isLabelHidden size="lg" width="100%" startIcon={Search} placeholder={placeholder} autoComplete="off" value="" />
        <p data-lookup-error role="alert" hidden className="m-0 type-caption text-removed">
          {WRONG}
        </p>
      </div>
      <Button label={label} variant="primary" size="lg" type="submit" endContent={<Icon icon={ArrowRight} size="sm" />} />
    </form>
  );
}
