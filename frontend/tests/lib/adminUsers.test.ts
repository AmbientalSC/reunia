import { describe, expect, mock, test } from "bun:test";

mock.module("@/config/firebase", () => ({ functions: {} }));
mock.module("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: [] }) }));

const { userFormSchema } = await import("../../src/lib/adminUsers");

describe("userFormSchema", () => {
  test("normalizes e-mail to lowercase and trims", () => {
    const result = userFormSchema.parse({ email: "  Fulano@Ambiental.SC ", role: "user" });
    expect(result.email).toBe("fulano@ambiental.sc");
  });

  test("rejects e-mail outside the allowed domain", () => {
    expect(userFormSchema.safeParse({ email: "a@gmail.com", role: "user" }).success).toBe(false);
  });

  test("rejects unknown role", () => {
    expect(userFormSchema.safeParse({ email: "a@ambiental.sc", role: "root" }).success).toBe(false);
  });
});

describe("userFormSchema groqApiKey", () => {
  const base = { email: "a@ambiental.sc", role: "user" as const };
  const validKey = `gsk_${"a1B2".repeat(13)}`;

  test("accepts the form without a Groq key", () => {
    expect(userFormSchema.safeParse(base).success).toBe(true);
  });

  test("accepts a blank Groq key (means: keep the stored one)", () => {
    expect(userFormSchema.safeParse({ ...base, groqApiKey: "   " }).success).toBe(true);
  });

  test("accepts and trims a well-formed Groq key", () => {
    const result = userFormSchema.parse({ ...base, groqApiKey: ` ${validKey} ` });
    expect(result.groqApiKey).toBe(validKey);
  });

  test("rejects a malformed Groq key", () => {
    expect(userFormSchema.safeParse({ ...base, groqApiKey: "sk-not-a-groq-key-123456789" }).success).toBe(false);
  });
});
