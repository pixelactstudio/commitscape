import { describe, expect, test } from "vitest";
import { SLOTS } from "../git/highlight";
import { tokenize } from "./syntax";

const slotOf = (lines: [string, number][][], text: string) => SLOTS[lines.flat().find(([t]) => t.includes(text))?.[1] ?? 0];

describe("syntax slots", () => {
  test("names the theme's token for each part of the code", async () => {
    const marked = await tokenize('// hello\nconst answer: number = add(41, 1);\nconst word = "hi";\n', "typescript");
    const lines = marked?.lines ?? [];
    expect(lines).toHaveLength(4);
    expect(slotOf(lines, "hello")).toBe("comment");
    expect(slotOf(lines, "const")).toBe("keyword");
    expect(slotOf(lines, "number")).toBe("type");
    expect(slotOf(lines, "add")).toBe("function");
    expect(slotOf(lines, "41")).toBe("number");
    expect(slotOf(lines, "hi")).toBe("string");
  });

  test("keeps every character, and says nothing of a language it does not know", async () => {
    const code = "fn main() {\n    println!(\"x\");\n}";
    const marked = await tokenize(code, "rust");
    expect(marked?.lines.map((l) => l.map(([t]) => t).join("")).join("\n")).toBe(code);
    expect(await tokenize("x", "no-such-language")).toBeNull();
  });
});
