import { parseTarget } from "@commitscape/data/github";
import { app, THEME_KEY } from "../env";
import { startAnalytics, track } from "./analytics";
import type { Scene } from "./scene";

const root = document.documentElement;
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : darkScheme.matches);

function dressCards(): void {
  const dark = isDark();
  document.querySelectorAll<HTMLElement>("[data-themed-card]").forEach((box) => {
    const img = box.querySelector("img");
    if (!img) return;
    const loaded = () => box.setAttribute("data-loaded", "");
    if (img.complete && img.naturalWidth > 0) loaded();
    else img.addEventListener("load", loaded, { once: true });
    if (!root.dataset.theme) return;
    box.querySelector("source")?.remove();
    const want = (dark ? img.dataset.dark : img.dataset.light) ?? img.src;
    if (img.getAttribute("src") !== want) img.src = want;
  });
}

function quiet(): void {
  root.classList.add("no-transitions");
  void root.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transitions")));
}

function remember(mode: string): boolean {
  try {
    localStorage.setItem(THEME_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

function themeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle] button");
  if (!button) return;
  const label = () => {
    const words = isDark() ? "Switch to the light theme" : "Switch to the dark theme";
    button.setAttribute("aria-label", words);
    button.title = words;
  };
  label();
  button.addEventListener("click", () => {
    quiet();
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    remember(next);
    track("theme changed", { theme: next });
    label();
    dressCards();
  });
  darkScheme.addEventListener("change", () => {
    quiet();
    label();
  });
}

function reveals(): void {
  const items = document.querySelectorAll<HTMLElement>("[data-reveal]");
  const shown = (el: Element) => el.setAttribute("data-shown", "");
  if (!("IntersectionObserver" in window)) return items.forEach(shown);
  const watch = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        shown(e.target);
        watch.unobserve(e.target);
      }
    },
    { threshold: 0.3, rootMargin: "0px 0px -10% 0px" },
  );
  items.forEach((el) => watch.observe(el));
}

function lookups(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-lookup]").forEach((form) => {
    const input = form.querySelector("input");
    const error = form.querySelector<HTMLElement>("[data-lookup-error]");
    if (!input) return;
    const wrong = (on: boolean) => {
      if (error) error.hidden = !on;
      input.setAttribute("aria-invalid", String(on));
      if (on && error) {
        error.id ||= `${input.id}-error`;
        input.setAttribute("aria-describedby", error.id);
      } else input.removeAttribute("aria-describedby");
    };
    input.addEventListener("input", () => wrong(false));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const target = parseTarget(input.value);
      if (!target) return wrong(true);
      track("lookup submitted", { kind: target.kind });
      window.location.assign(app(target.kind === "person" ? `/u/${encodeURIComponent(target.login)}` : `/gh/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}`));
    });
    if (form.hasAttribute("data-autofocus") && window.matchMedia("(hover: hover) and (pointer: fine)").matches && window.scrollY === 0 && !window.location.hash) input.focus({ preventScroll: true });
  });
}

const builders = import.meta.glob<{ scene: Scene }>("./builders/*.ts");

function scenes(): void {
  const start = async (el: HTMLElement) => {
    const load = builders[`./builders/${el.dataset.scene}.ts`];
    if (!load) return;
    const [{ gsap }, { runScene }, { scene }] = await Promise.all([import("gsap"), import("./scene"), load()]);
    runScene(gsap, el, scene);
  };
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        near.unobserve(e.target);
        void start(e.target as HTMLElement);
      }
    },
    { rootMargin: "300px 0px" },
  );
  document.querySelectorAll<HTMLElement>("[data-scene]").forEach((el) => near.observe(el));
}

function installPicker(): void {
  const box = document.querySelector<HTMLElement>("[data-install]");
  const view = box?.querySelector<HTMLElement>("[data-install-view]");
  if (!box || !view) return;
  let tab = "npm";
  const show = (next: string, copied: boolean, focus: "radio" | "copy" | null) => {
    const state = box.querySelector<HTMLTemplateElement>(`template[data-install-state="${next}:${copied ? 1 : 0}"]`);
    if (!state) return;
    tab = next;
    view.replaceChildren(state.content.cloneNode(true));
    if (focus === "radio") view.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    if (focus === "copy") view.querySelector<HTMLElement>("[data-copy] button")?.focus();
  };
  const tabs = () => Array.from(view.querySelectorAll<HTMLElement>('[role="radio"]')).map((el) => el.dataset.value ?? "");
  view.addEventListener("click", (e) => {
    const target = e.target as Element;
    const radio = target.closest<HTMLElement>('[role="radio"]');
    if (radio?.dataset.value) return show(radio.dataset.value, false, "radio");
    if (!target.closest("[data-copy]")) return;
    const command = view.querySelector("[data-command]")?.textContent?.trim() ?? "";
    void navigator.clipboard?.writeText(command).then(() => {
      track("install command copied", { how: tab });
      show(tab, true, "copy");
    });
  });
  view.addEventListener("keydown", (e) => {
    if (!(e.target as Element).closest('[role="radio"]')) return;
    const all = tabs();
    const at = all.indexOf(tab);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const next = step !== undefined ? all[(at + step + all.length) % all.length] : e.key === "Home" ? all[0] : e.key === "End" ? all.at(-1) : undefined;
    if (next === undefined) return;
    e.preventDefault();
    show(next, false, "radio");
  });
}

dressCards();
themeToggle();
reveals();
lookups();
scenes();
installPicker();
if ("requestIdleCallback" in window) window.requestIdleCallback(() => void startAnalytics(), { timeout: 2000 });
else setTimeout(() => void startAnalytics(), 500);
