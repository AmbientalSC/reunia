import { describe, expect, test } from "bun:test";

const { parseInput } = await import("../scripts/import-users.mjs");

const KEY_A = `gsk_${"a1B2".repeat(13)}`;
const KEY_B = `gsk_${"z9Y8".repeat(13)}`;

describe("parseInput", () => {
  test("accepts one e-mail per line and lowercases it", () => {
    const { entries, problems } = parseInput("Maria.Silva@ambiental.sc\njoao@ambiental.sc\n");

    expect(problems).toEqual([]);
    expect(entries.map((entry) => entry.email)).toEqual(["maria.silva@ambiental.sc", "joao@ambiental.sc"]);
  });

  test("ignores blank lines, comments, header and the Excel BOM", () => {
    const { entries, problems } = parseInput("﻿email;chave\n\n# time de TI\nana@ambiental.sc\n");

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
  });

  test("uses the per-line key when present and the shared key otherwise", () => {
    const { entries } = parseInput(`ana@ambiental.sc;${KEY_A}\nbia@ambiental.sc\n`, KEY_B);

    expect(entries).toEqual([
      { email: "ana@ambiental.sc", groqApiKey: KEY_A },
      { email: "bia@ambiental.sc", groqApiKey: KEY_B },
    ]);
  });

  test("leaves the key empty when neither the line nor the shared key provide one", () => {
    const { entries } = parseInput("ana@ambiental.sc\n");

    expect(entries[0].groqApiKey).toBe("");
  });

  test("accepts comma, semicolon and tab separators and quoted cells", () => {
    const { entries, problems } = parseInput(
      `"a@ambiental.sc","${KEY_A}"\nb@ambiental.sc\t${KEY_A}\nc@ambiental.sc,${KEY_A}\n`
    );

    expect(problems).toEqual([]);
    expect(entries.every((entry) => entry.groqApiKey === KEY_A)).toBe(true);
  });

  test("reports e-mails outside the company domain with the line number", () => {
    const { entries, problems } = parseInput("ok@ambiental.sc\nfora@gmail.com\n");

    expect(entries).toHaveLength(1);
    expect(problems).toEqual([{ lineNumber: 2, reason: 'e-mail inválido: "fora@gmail.com"' }]);
  });

  test("reports malformed Groq keys without echoing the key", () => {
    const { entries, problems } = parseInput("ana@ambiental.sc;sk-errada\n");

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).not.toContain("sk-errada");
  });

  test("reports duplicated e-mails and keeps only the first", () => {
    const { entries, problems } = parseInput("ana@ambiental.sc\nANA@ambiental.sc\n");

    expect(entries).toHaveLength(1);
    expect(problems).toEqual([{ lineNumber: 2, reason: "e-mail repetido: ana@ambiental.sc" }]);
  });
});
