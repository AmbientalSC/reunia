import { describe, expect, mock, test } from "bun:test";

mock.module("@/config/firebase", () => ({ functions: {} }));
mock.module("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: [] }) }));

const { userFormSchema, formatLastAccess, formatAudioHours, countRecentlyActive, sortByLastAccess } = await import(
  "../../src/lib/adminUsers"
);
import type { ManagedUser } from "../../src/lib/adminUsers";

const NOW = new Date("2026-10-29T12:00:00.000Z");

function managedUser(email: string, overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    email,
    role: "user",
    authorized: true,
    hasGroqKey: false,
    lastAccessAt: null,
    accessCount: 0,
    meetingsCount: 0,
    audioSeconds: 0,
    summariesCount: 0,
    ...overrides,
  };
}

describe("formatLastAccess", () => {
  test("says there is no record when the app never reported an access", () => {
    expect(formatLastAccess(null, NOW)).toBe("Sem registro");
  });

  test("shows a relative time in Portuguese", () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const text = formatLastAccess(twoHoursAgo, NOW);
    expect(text).toContain("há");
    expect(text).toContain("2 horas");
  });

  test("falls back to no record for an unparseable date", () => {
    expect(formatLastAccess("not-a-date", NOW)).toBe("Sem registro");
  });

  test("never describes the access as being in the future when the clocks disagree", () => {
    const fiveMinutesAhead = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
    expect(formatLastAccess(fiveMinutesAhead, NOW)).not.toContain("em ");
  });
});

describe("formatAudioHours", () => {
  test("uses minutes below one hour", () => {
    expect(formatAudioHours(0)).toBe("0 min");
    expect(formatAudioHours(1800)).toBe("30 min");
  });

  test("uses hours with a decimal comma from one hour up", () => {
    expect(formatAudioHours(5400)).toBe("1,5 h");
    expect(formatAudioHours(36000)).toBe("10,0 h");
  });

  test("never shows 60 min: a value that rounds up to an hour switches to hours", () => {
    expect(formatAudioHours(3599)).toBe("1,0 h");
    expect(formatAudioHours(3569)).toBe("59 min");
  });
});

describe("countRecentlyActive", () => {
  test("counts only users who accessed within the window", () => {
    const day = 24 * 60 * 60 * 1000;
    const users = [
      managedUser("a@ambiental.sc", { lastAccessAt: new Date(NOW.getTime() - 1 * day).toISOString() }),
      managedUser("b@ambiental.sc", { lastAccessAt: new Date(NOW.getTime() - 6 * day).toISOString() }),
      managedUser("c@ambiental.sc", { lastAccessAt: new Date(NOW.getTime() - 8 * day).toISOString() }),
      managedUser("d@ambiental.sc"),
    ];
    expect(countRecentlyActive(users, 7, NOW)).toBe(2);
  });

  test("includes an access exactly at the edge of the window", () => {
    const edge = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(countRecentlyActive([managedUser("a@ambiental.sc", { lastAccessAt: edge })], 7, NOW)).toBe(1);
  });
});

describe("sortByLastAccess", () => {
  test("puts the most recent access first and users without record last, without mutating the input", () => {
    const users = [
      managedUser("never@ambiental.sc"),
      managedUser("old@ambiental.sc", { lastAccessAt: "2026-10-01T00:00:00.000Z" }),
      managedUser("new@ambiental.sc", { lastAccessAt: "2026-10-28T00:00:00.000Z" }),
      managedUser("another-never@ambiental.sc"),
    ];
    const snapshot = [...users];

    const sorted = sortByLastAccess(users);

    expect(sorted.map((user) => user.email)).toEqual([
      "new@ambiental.sc",
      "old@ambiental.sc",
      "another-never@ambiental.sc",
      "never@ambiental.sc",
    ]);
    expect(users).toEqual(snapshot);
  });
});

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
