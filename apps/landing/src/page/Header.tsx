import { Button } from "@astryxdesign/core/Button";
import { TopNav } from "@astryxdesign/core/TopNav";
import { Moon, Sun } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { Logo } from "@commitscape/ui/components/Logo";
import { ICON } from "@commitscape/ui/design";
import { SIGN_IN } from "../env";

/** The bar at the top: the name, the theme and signing in on the app, on the frame's edges. */
export function Header() {
  return (
    <header className="sticky top-0 z-(--z-header) border-b border-line bg-surface">
      <TopNav
        label={PRODUCT}
        heading={
          <a href="/" className="flex items-center gap-2 rounded-lg pe-2 text-lg font-semibold tracking-tight text-primary no-underline" aria-label={`${PRODUCT}, home`}>
            <Logo size={26} />
            <span className="hidden sm:inline">{PRODUCT}</span>
          </a>
        }
        endContent={
          <div className="flex items-center gap-1.5">
            <span data-theme-toggle className="contents">
              <Button
                label="Switch theme"
                isIconOnly
                variant="ghost"
                size="md"
                icon={
                  <span className="theme-icons grid place-items-center">
                    <Sun size={ICON.md} className="theme-sun" aria-hidden />
                    <Moon size={ICON.md} className="theme-moon" aria-hidden />
                  </span>
                }
              />
            </span>
            <Button label="Sign in" variant="secondary" size="sm" href={SIGN_IN} />
          </div>
        }
      />
    </header>
  );
}
