import { describe, expect, test } from "bun:test";

import {
  findValidationError,
  formFromDraft,
  toDraft,
  toFormSection,
  type FormState,
} from "../../src/components/templates/templateForm";

const draft = {
  name: "Ata",
  description: "Reuniões de diretoria",
  sections: [
    { title: "Resumo", instruction: "Resuma.", format: "paragraph" as const },
    {
      title: "Ações",
      instruction: "Liste.",
      format: "list" as const,
      item_format: "| Tarefa |\n| --- |",
    },
  ],
};

describe("formFromDraft", () => {
  test("gives every section a unique uid", () => {
    const uids = formFromDraft(draft).sections.map((s) => s.uid);

    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe("toFormSection", () => {
  test("folds example_item_format into item_format so it is visible in the form", () => {
    const section = toFormSection({
      title: "Ontem",
      instruction: "O que foi feito",
      format: "list",
      example_item_format: "| a |",
    });

    expect(section.item_format).toBe("| a |");
    expect(section.example_item_format).toBeNull();
  });

  test("keeps item_format when both are present", () => {
    const section = toFormSection({
      title: "T",
      instruction: "I",
      format: "list",
      item_format: "| novo |",
      example_item_format: "| antigo |",
    });

    expect(section.item_format).toBe("| novo |");
  });
});

describe("findValidationError", () => {
  const valid = formFromDraft(draft);

  test("accepts a complete form", () => {
    expect(findValidationError(valid)).toBeNull();
  });

  test("requires a name and a description", () => {
    expect(findValidationError({ ...valid, name: "  " })).toContain("nome");
    expect(findValidationError({ ...valid, description: "" })).toContain("descrição");
  });

  test("requires at least one section", () => {
    expect(findValidationError({ ...valid, sections: [] })).toContain("seção");
  });

  test("requires title and instruction on every section", () => {
    const blankInstruction: FormState = {
      ...valid,
      sections: [{ ...valid.sections[0], instruction: " " }],
    };

    expect(findValidationError(blankInstruction)).toContain("instrução");
  });
});

describe("toDraft", () => {
  test("round-trips the content and strips client-only fields", () => {
    const result = toDraft(formFromDraft(draft));

    expect(result.name).toBe("Ata");
    expect(result.sections.map((s) => s.title)).toEqual(["Resumo", "Ações"]);
    expect(result.sections[1].item_format).toBe("| Tarefa |\n| --- |");
    expect("uid" in result.sections[0]).toBe(false);
  });

  test("drops item formats from sections that are not lists", () => {
    const form = formFromDraft(draft);
    form.sections[1] = { ...form.sections[1], format: "paragraph" };

    expect(toDraft(form).sections[1].item_format).toBeNull();
  });
});
