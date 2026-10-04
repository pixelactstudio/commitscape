import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ARCHETYPES } from "@commitscape/data";

test("CONTEXT.md states every Archetype's rule as the code does", () => {
  const glossary = readFileSync(new URL("../../../../CONTEXT.md", import.meta.url), "utf8");
  for (const a of ARCHETYPES) expect(glossary).toContain(`- **${a.title}**: ${a.rule.charAt(0).toLowerCase()}${a.rule.slice(1)}`);
});
