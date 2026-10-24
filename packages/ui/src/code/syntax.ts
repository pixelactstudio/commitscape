import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { SLOTS, type Marked, type Slot } from "../git/highlight";

const SCOPES: [Slot, string[]][] = [
  ["comment", ["comment", "punctuation.definition.comment", "string.comment"]],
  ["string", ["string", "punctuation.definition.string", "string.regexp", "markup.inline.raw", "markup.fenced_code", "constant.other.symbol"]],
  ["number", ["constant.numeric"]],
  ["constant", ["constant", "constant.language", "constant.character", "constant.other", "variable.other.constant", "support.constant", "variable.language", "variable.other.enummember"]],
  ["keyword", ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.other", "keyword.declaration", "entity.name.tag.yaml punctuation"]],
  ["operator", ["keyword.operator", "punctuation.accessor", "keyword.operator.new", "storage.type.function.arrow"]],
  ["function", ["entity.name.function", "support.function", "meta.function-call.generic", "variable.function", "entity.name.function.macro", "support.function.builtin"]],
  ["type", ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "entity.name.namespace", "entity.name.type.module", "storage.type.primitive", "entity.name.scope-resolution", "meta.type.annotation entity.name.type"]],
  ["tag", ["entity.name.tag", "support.class.component", "meta.tag.sgml"]],
  ["attribute", ["entity.other.attribute-name", "meta.attribute", "meta.decorator", "punctuation.decorator", "entity.name.function.decorator", "meta.annotation"]],
  ["property", ["variable.other.property", "variable.other.object.property", "support.type.property-name", "meta.object-literal.key", "entity.name.tag.yaml", "support.variable.property", "entity.name.field", "variable.other.member", "entity.name.tag.toml", "support.type.property-name.toml"]],
  ["punctuation", ["punctuation", "meta.brace", "punctuation.definition.tag", "punctuation.separator", "punctuation.terminator"]],
  ["variable", ["variable", "variable.parameter", "variable.other.readwrite"]],
  ["added-marker", ["markup.inserted", "punctuation.definition.inserted"]],
  ["removed-marker", ["markup.deleted", "punctuation.definition.deleted"]],
  ["heading", ["markup.heading", "entity.name.section", "markup.heading entity.name"]],
  ["link", ["markup.underline.link", "string.other.link", "markup.link"]],
];

const hexOf = (slot: number) => `#${slot.toString(16).padStart(6, "0")}`;

const THEME: ThemeRegistration = {
  name: "commitscape-slots",
  type: "dark",
  fg: hexOf(0),
  bg: "#ffffff",
  settings: [{ settings: { foreground: hexOf(0), background: "#ffffff" } }, ...SCOPES.map(([slot, scope]) => ({ scope, settings: { foreground: hexOf(SLOTS.indexOf(slot)) } }))],
};

let ready: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();

function core(): Promise<HighlighterCore> {
  ready ??= createHighlighterCore({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine() });
  return ready;
}

/** Some code as lines of [text, slot], each slot one of the theme's syntax tokens; null when Shiki does not know the language. */
export async function tokenize(code: string, lang: string): Promise<Marked | null> {
  const load = (bundledLanguages as Record<string, () => Promise<unknown>>)[lang];
  if (!load) return null;
  const shiki = await core();
  if (!loaded.has(lang)) {
    await shiki.loadLanguage(load as never);
    loaded.add(lang);
  }
  const { tokens } = shiki.codeToTokens(code, { lang, theme: "commitscape-slots", tokenizeTimeLimit: 5000 });
  const lines = tokens.map((line) => {
    const out: [string, number][] = [];
    for (const t of line) {
      const slot = Number.parseInt((t.color ?? "#000000").slice(1, 7), 16) || 0;
      const last = out[out.length - 1];
      if (last && last[1] === slot) last[0] += t.content;
      else out.push([t.content, slot < SLOTS.length ? slot : 0]);
    }
    return out;
  });
  return { lines };
}
