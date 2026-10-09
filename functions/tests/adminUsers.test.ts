import { describe, expect, test } from "bun:test";

const { parseGroqApiKey } = await import("../src/adminUsers");

const VALID_KEY = `gsk_${"a1B2".repeat(13)}`;

describe("parseGroqApiKey", () => {
  test("returns undefined when the field is absent so the stored key is kept", () => {
    expect(parseGroqApiKey(undefined)).toBeUndefined();
  });

  test("treats a blank string as absent", () => {
    expect(parseGroqApiKey("   ")).toBeUndefined();
  });

  test("returns null to signal that the stored key must be removed", () => {
    expect(parseGroqApiKey(null)).toBeNull();
  });

  test("trims and accepts a well-formed Groq key", () => {
    expect(parseGroqApiKey(`  ${VALID_KEY}\n`)).toBe(VALID_KEY);
  });

  test("rejects keys without the gsk_ prefix", () => {
    expect(() => parseGroqApiKey("sk-proj-abcdefghijklmnopqrstuvwxyz")).toThrow();
  });

  test("rejects keys that are too short", () => {
    expect(() => parseGroqApiKey("gsk_abc")).toThrow();
  });

  test("rejects keys containing whitespace", () => {
    expect(() => parseGroqApiKey("gsk_aaaaaaaaaa bbbbbbbbbbbbbbbb")).toThrow();
  });

  test("rejects non-string values", () => {
    expect(() => parseGroqApiKey(123)).toThrow();
  });
});

const { toManagedUser, buildProfileUpdate } = await import("../src/adminUsers");

describe("toManagedUser", () => {
  test("never exposes the stored Groq key, only whether one exists", () => {
    const user = toManagedUser("a@ambiental.sc", { role: "admin", authorized: true, groqApiKey: VALID_KEY });
    expect(user).toEqual({ email: "a@ambiental.sc", role: "admin", authorized: true, hasGroqKey: true });
    expect(JSON.stringify(user)).not.toContain(VALID_KEY);
  });

  test("reports no key for a blank or missing value", () => {
    expect(toManagedUser("a@ambiental.sc", { groqApiKey: "  " }).hasGroqKey).toBe(false);
    expect(toManagedUser("a@ambiental.sc", {}).hasGroqKey).toBe(false);
  });

  test("falls back to a blocked regular user for unknown data", () => {
    expect(toManagedUser("a@ambiental.sc", undefined)).toEqual({
      email: "a@ambiental.sc",
      role: "user",
      authorized: false,
      hasGroqKey: false,
    });
  });
});

describe("buildProfileUpdate", () => {
  test("leaves groqApiKey out when it was not sent so merge keeps the stored one", () => {
    expect(buildProfileUpdate("user", undefined)).toEqual({ authorized: true, role: "user" });
  });

  test("sets the key when one is sent", () => {
    expect(buildProfileUpdate("user", VALID_KEY)).toEqual({ authorized: true, role: "user", groqApiKey: VALID_KEY });
  });

  test("marks the field for deletion when null", () => {
    const update = buildProfileUpdate("admin", null);
    expect("groqApiKey" in update).toBe(true);
    expect(update.groqApiKey).not.toBeNull();
    expect(typeof update.groqApiKey).not.toBe("string");
  });
});
