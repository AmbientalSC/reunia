import { describe, expect, test } from "bun:test";

import {
  MAX_SELECTION_CHARS,
  buildAskContext,
  computeButtonPosition,
  normalizeSelection,
  windowAroundTerm,
} from "../../src/lib/ask-selection";

describe("normalizeSelection", () => {
  test("collapses whitespace and line breaks", () => {
    expect(normalizeSelection("  prazo \n de   entrega  ")).toBe("prazo de entrega");
  });

  test("rejects empty, whitespace-only and too-short selections", () => {
    expect(normalizeSelection(null)).toBeNull();
    expect(normalizeSelection(undefined)).toBeNull();
    expect(normalizeSelection("   \n ")).toBeNull();
    expect(normalizeSelection("ab")).toBeNull();
  });

  test("rejects selections that are too long to be a phrase", () => {
    expect(normalizeSelection("a".repeat(MAX_SELECTION_CHARS + 1))).toBeNull();
    expect(normalizeSelection("a".repeat(MAX_SELECTION_CHARS))).not.toBeNull();
  });
});

describe("buildAskContext", () => {
  test("joins non-empty parts with a blank line", () => {
    expect(buildAskContext(["Tópico: LGPD", null, "  ", "texto"])).toBe("Tópico: LGPD\n\ntexto");
  });

  test("returns an empty string when there is nothing to send", () => {
    expect(buildAskContext([undefined, ""])).toBe("");
  });

  test("keeps the most recent text when over the limit, cutting at a word boundary", () => {
    const result = buildAskContext(["um dois três quatro cinco seis"], 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("seis")).toBe(true);
    expect(result.startsWith("três")).toBe(false);
    expect("um dois três quatro cinco seis").toContain(result);
  });

  test("never returns a partial leading word when a boundary exists", () => {
    const result = buildAskContext(["alfa bravo charlie delta"], 15);

    expect(["bravo charlie delta", "charlie delta", "delta"]).toContain(result);
  });
});

describe("windowAroundTerm", () => {
  const filler = (n: number) => "palavra ".repeat(n);

  test("returns the whole text when it already fits", () => {
    expect(windowAroundTerm("falaram da LGPD hoje", "LGPD", 100)).toBe("falaram da LGPD hoje");
  });

  test("centers the window on the first mention of the term, ignoring case", () => {
    const text = `${filler(300)}a lgpd exige um encarregado ${filler(300)}`;

    const result = windowAroundTerm(text, "LGPD", 200);

    expect(result).toContain("lgpd exige um encarregado");
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test("does not cut words at the edges of the window", () => {
    const text = `${filler(300)}LGPD ${filler(300)}`;

    const result = windowAroundTerm(text, "LGPD", 200);

    for (const word of result.split(" ")) {
      expect(["palavra", "LGPD"]).toContain(word);
    }
  });

  test("falls back to the end of the text when the term is not found", () => {
    const text = `${filler(300)}FIM`;

    const result = windowAroundTerm(text, "inexistente", 100);

    expect(result.endsWith("FIM")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  test("treats regex characters in the term literally", () => {
    const text = `${filler(200)}custo (R$ 5.000) aprovado ${filler(200)}`;

    expect(windowAroundTerm(text, "(R$ 5.000)", 120)).toContain("(R$ 5.000)");
  });

  test("works when the term is at the very start or end", () => {
    expect(windowAroundTerm(`LGPD ${filler(300)}`, "LGPD", 100).startsWith("LGPD")).toBe(true);
    expect(windowAroundTerm(`${filler(300)}LGPD`, "LGPD", 100).endsWith("LGPD")).toBe(true);
  });
});

describe("computeButtonPosition", () => {
  const viewport = { width: 1000, height: 700 };

  test("centers the button above the selection", () => {
    const position = computeButtonPosition({ top: 300, bottom: 320, left: 400, width: 100 }, viewport);

    expect(position.left).toBe(450);
    expect(position.top).toBeLessThan(300);
  });

  test("goes below the selection when there is no room above", () => {
    const position = computeButtonPosition({ top: 10, bottom: 30, left: 400, width: 100 }, viewport);

    expect(position.top).toBeGreaterThan(30);
  });

  test("stays inside the viewport horizontally and vertically", () => {
    const left = computeButtonPosition({ top: 300, bottom: 320, left: 0, width: 10 }, viewport);
    const right = computeButtonPosition({ top: 300, bottom: 320, left: 990, width: 10 }, viewport);
    const bottom = computeButtonPosition({ top: 5, bottom: 690, left: 400, width: 100 }, viewport);

    expect(left.left).toBeGreaterThanOrEqual(70);
    expect(right.left).toBeLessThanOrEqual(1000 - 70);
    expect(bottom.top).toBeLessThanOrEqual(700 - 36);
  });
});
