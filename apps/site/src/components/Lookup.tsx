import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Typeahead } from "@astryxdesign/core/Typeahead";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { parseTarget } from "@commitscape/data";
import { LookupRow, useLookupSource, type Item } from "#/lib/lookup";

/** The large search box: a GitHub username or a repository, with suggestions from GitHub as it is typed. */
export function Lookup({ autoFocus = false, label = "Show me" }: { autoFocus?: boolean; label?: string }) {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "__root__" });
  const source = useLookupSource(user?.login ?? null);
  const [query, setQuery] = useState("");
  const [wrong, setWrong] = useState(false);
  const go = () => {
    const target = parseTarget(query);
    if (!target) return setWrong(true);
    if (target.kind === "person") void navigate({ to: "/u/$login", params: { login: target.login } });
    else void navigate({ to: "/gh/$owner/$repo", params: { owner: target.owner, repo: target.name } });
  };
  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="min-w-0 flex-1">
        <Typeahead<Item>
          label="A GitHub username or repository"
          isLabelHidden
          size="lg"
          width="100%"
          startIcon={Search}
          placeholder="GitHub username, or owner/repo"
          searchSource={source}
          value={null}
          hasAutoFocus={autoFocus}
          debounceMs={0}
          minQueryLength={1}
          maxMenuItems={9}
          emptySearchResultsText="Nobody by that name yet. Press Enter to look anyway."
          onChangeQuery={(q) => {
            setQuery(q);
            setWrong(false);
          }}
          onChange={(item) => {
            const to = item?.auxiliaryData?.to;
            if (to) void navigate({ to: to as "/" });
          }}
          renderItem={(item) => <LookupRow item={item} selected={false} />}
          status={wrong ? { type: "error", message: "Type a GitHub username, like gaearon, or a repository, like react/react." } : undefined}
          statusVariant="detached"
        />
      </div>
      <Button label={label} variant="primary" size="lg" type="submit" endContent={<Icon icon={ArrowRight} size="sm" />} />
    </form>
  );
}
