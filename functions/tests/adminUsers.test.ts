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

const {
  toManagedUser,
  buildProfileUpdate,
  assertCanChangeAuthorization,
  assertCanChangeRole,
  normalizeAllowedEmail,
  requireCallerEmail,
} = await import("../src/adminUsers");
const { Timestamp } = await import("firebase-admin/firestore");

const NO_USAGE = { lastAccessAt: null, accessCount: 0, meetingsCount: 0, audioSeconds: 0, summariesCount: 0 };

describe("toManagedUser", () => {
  test("never exposes the stored Groq key, only whether one exists", () => {
    const user = toManagedUser("a@ambiental.sc", { role: "admin", authorized: true, groqApiKey: VALID_KEY });
    expect(user).toEqual({
      email: "a@ambiental.sc",
      role: "admin",
      authorized: true,
      hasGroqKey: true,
      ...NO_USAGE,
    });
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
      ...NO_USAGE,
    });
  });

  test("serializes usage counters and converts the last access Timestamp to ISO", () => {
    const lastAccess = new Date("2026-10-28T14:30:00.000Z");
    const user = toManagedUser("a@ambiental.sc", {
      authorized: true,
      lastAccessAt: Timestamp.fromDate(lastAccess),
      accessCount: 7,
      usage: { meetingsCount: 3, audioSeconds: 5400, summariesCount: 2 },
    });

    expect(user.lastAccessAt).toBe("2026-10-28T14:30:00.000Z");
    expect(user.accessCount).toBe(7);
    expect(user.meetingsCount).toBe(3);
    expect(user.audioSeconds).toBe(5400);
    expect(user.summariesCount).toBe(2);
  });

  test("sanitizes counters that are negative, non-numeric or missing", () => {
    const user = toManagedUser("a@ambiental.sc", {
      accessCount: -4,
      usage: { meetingsCount: "many", audioSeconds: Number.NaN },
    });

    expect(user.accessCount).toBe(0);
    expect(user.meetingsCount).toBe(0);
    expect(user.audioSeconds).toBe(0);
    expect(user.summariesCount).toBe(0);
  });

  test("returns null for a lastAccessAt that is not a Timestamp", () => {
    expect(toManagedUser("a@ambiental.sc", { lastAccessAt: "yesterday" }).lastAccessAt).toBeNull();
  });
});

describe("normalizeAllowedEmail", () => {
  test("trims and lowercases an allowed address", () => {
    expect(normalizeAllowedEmail("  Ana.Silva@Ambiental.SC ")).toBe("ana.silva@ambiental.sc");
  });

  test("rejects other domains, lookalike domains and non-strings", () => {
    expect(normalizeAllowedEmail("ana@gmail.com")).toBeNull();
    expect(normalizeAllowedEmail("ana@evil.ambiental.sc")).toBeNull();
    expect(normalizeAllowedEmail("ana@ambiental.sc.evil.com")).toBeNull();
    expect(normalizeAllowedEmail(42)).toBeNull();
    expect(normalizeAllowedEmail(undefined)).toBeNull();
  });

  test("rejects non-ASCII look-alikes that lowercase into a real address (Kelvin sign)", () => {
    expect("Karla@ambiental.sc".toLowerCase()).toBe("karla@ambiental.sc");
    expect(normalizeAllowedEmail("Karla@ambiental.sc")).toBeNull();
  });

  test("rejects a local part longer than 64 characters", () => {
    expect(normalizeAllowedEmail(`${"a".repeat(65)}@ambiental.sc`)).toBeNull();
    expect(normalizeAllowedEmail(`${"a".repeat(64)}@ambiental.sc`)).not.toBeNull();
  });
});

describe("requireCallerEmail", () => {
  const callerWith = (token: Record<string, unknown>, uid = "msft:abc-123") =>
    ({ auth: { uid, token } }) as unknown as Parameters<typeof requireCallerEmail>[0];

  test("returns the lowercased e-mail of a custom-token session minted by the Microsoft exchange", () => {
    const request = callerWith({ email: "Ana@Ambiental.SC", firebase: { sign_in_provider: "custom" } });
    expect(requireCallerEmail(request)).toBe("ana@ambiental.sc");
  });

  test("rejects unauthenticated calls", () => {
    expect(() => requireCallerEmail({} as unknown as Parameters<typeof requireCallerEmail>[0])).toThrow();
  });

  test("rejects a session from another sign-in provider that merely carries an e-mail claim", () => {
    const request = callerWith({ email: "admin@ambiental.sc", firebase: { sign_in_provider: "password" } });
    expect(() => requireCallerEmail(request)).toThrow();
  });

  test("rejects a custom token whose uid was not issued by the Microsoft exchange", () => {
    const request = callerWith({ email: "admin@ambiental.sc", firebase: { sign_in_provider: "custom" } }, "someone-else");
    expect(() => requireCallerEmail(request)).toThrow();
  });
});

describe("assertCanChangeRole", () => {
  test("allows an admin to change another user's role", () => {
    expect(() =>
      assertCanChangeRole({ callerEmail: "admin@ambiental.sc", targetEmail: "ana@ambiental.sc", role: "admin" })
    ).not.toThrow();
  });

  test("refuses to let an admin demote themselves", () => {
    expect(() =>
      assertCanChangeRole({ callerEmail: "admin@ambiental.sc", targetEmail: "admin@ambiental.sc", role: "user" })
    ).toThrow();
  });
});

describe("assertCanChangeAuthorization", () => {
  const base = { callerEmail: "admin@ambiental.sc", targetEmail: "ana@ambiental.sc", targetRole: "user" as const, adminCount: 2 };

  test("allows blocking another regular user", () => {
    expect(() => assertCanChangeAuthorization({ ...base, authorized: false })).not.toThrow();
  });

  test("refuses to let an admin block themselves", () => {
    expect(() => assertCanChangeAuthorization({ ...base, targetEmail: base.callerEmail, authorized: false })).toThrow();
  });

  test("refuses to block the last remaining admin", () => {
    expect(() =>
      assertCanChangeAuthorization({ ...base, targetRole: "admin", adminCount: 1, authorized: false })
    ).toThrow();
  });

  test("allows blocking an admin when another admin remains", () => {
    expect(() =>
      assertCanChangeAuthorization({ ...base, targetRole: "admin", adminCount: 2, authorized: false })
    ).not.toThrow();
  });

  test("always allows unblocking", () => {
    expect(() =>
      assertCanChangeAuthorization({ ...base, targetRole: "admin", adminCount: 1, authorized: true })
    ).not.toThrow();
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
