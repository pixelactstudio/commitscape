import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link } from "@tanstack/react-router";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string };

const INTERNAL = /^\/(?!\/|api\/)/;

/** An anchor that moves between the Site's pages without reloading, and stays a plain anchor for files, API routes and other sites. */
export const RouterLink = forwardRef<HTMLAnchorElement, Props>(function RouterLink({ href, target, download, ...rest }, ref) {
  if (!href || !INTERNAL.test(href) || target === "_blank" || download !== undefined) return <a ref={ref} href={href} target={target} download={download} {...rest} />;
  const url = new URL(href, "http://site");
  const search = Object.fromEntries(url.searchParams);
  return <Link ref={ref} to={url.pathname as "/"} search={search as never} hash={url.hash ? url.hash.slice(1) : undefined} {...rest} />;
});
