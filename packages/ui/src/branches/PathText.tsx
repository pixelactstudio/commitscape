import { Fragment } from "react";

/** A path that wraps between folders rather than inside a name. */
export function PathText({ path, className = "" }: { path: string; className?: string }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className={`min-w-0 font-mono text-sm [overflow-wrap:anywhere] ${className}`}>
      <span className="text-tertiary">
        {path
          .slice(0, cut)
          .split("/")
          .filter(Boolean)
          .map((part, i) => (
            <Fragment key={i}>
              {part}/<wbr />
            </Fragment>
          ))}
      </span>
      <span className="font-medium text-primary">{path.slice(cut)}</span>
    </span>
  );
}
