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
