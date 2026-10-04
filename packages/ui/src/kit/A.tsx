import type { AnchorHTMLAttributes } from "react";
import { useLinkComponent } from "@astryxdesign/core/Link";

/** An anchor that uses the page's router for the Site's own addresses. */
export function A({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const Component = useLinkComponent();
  return <Component href={href} {...rest} />;
}
