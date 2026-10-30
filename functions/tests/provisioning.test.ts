import { describe, expect, test } from "bun:test";

const { buildAutoProfile, ensureUserProfile, pickDefaultGroqKey } = await import("../src/provisioning");
import type { ProfileStore } from "../src/provisioning";

const VALID_KEY = `gsk_${"a1B2".repeat(13)}`;

describe("buildAutoProfile", () => {
  test("creates an authorized regular user marked as auto-provisioned", () => {
    const profile = buildAutoProfile(undefined);
    expect(profile.authorized).toBe(true);
    expect(profile.role).toBe("user");
    expect(profile.provisionedBy).toBe("auto");
    expect(profile.createdAt).toBeDefined();
  });

  test("never grants admin and omits groqApiKey when no default key is configured", () => {
    const profile = buildAutoProfile(undefined);
    expect("groqApiKey" in profile).toBe(false);
  });

  test("copies the default Groq key into the profile", () => {
    expect(buildAutoProfile(VALID_KEY).groqApiKey).toBe(VALID_KEY);
  });
});

describe("pickDefaultGroqKey", () => {
  test("returns the trimmed key when it is well formed", () => {
    expect(pickDefaultGroqKey(`  ${VALID_KEY}\n`)).toBe(VALID_KEY);
  });

  test("returns undefined when the secret is missing or blank", () => {
    expect(pickDefaultGroqKey(undefined)).toBeUndefined();
    expect(pickDefaultGroqKey("   ")).toBeUndefined();
  });

  test("returns undefined for a malformed key instead of storing it", () => {
    expect(pickDefaultGroqKey("sk-proj-abcdefghijklmnopqrstuvwxyz")).toBeUndefined();
  });
});

const alreadyExists = () => Object.assign(new Error("already exists"), { code: 6 });

function fakeStore(overrides: Partial<ProfileStore> = {}): ProfileStore & { created: Array<{ email: string; data: Record<string, unknown> }> } {
  const created: Array<{ email: string; data: Record<string, unknown> }> = [];
  return {
    created,
    create: async (email, data) => {
      created.push({ email, data });
    },
    isAuthorized: async () => true,
    ...overrides,
  };
}

describe("ensureUserProfile", () => {
  test("creates the profile and reports it as created", async () => {
    const store = fakeStore();
    const result = await ensureUserProfile("ana@ambiental.sc", VALID_KEY, store);

    expect(result).toBe("created");
    expect(store.created).toHaveLength(1);
    expect(store.created[0].email).toBe("ana@ambiental.sc");
    expect(store.created[0].data.groqApiKey).toBe(VALID_KEY);
  });

  test("lets an existing authorized profile in without touching it", async () => {
    const store = fakeStore({
      create: async () => {
        throw alreadyExists();
      },
      isAuthorized: async () => true,
    });
    expect(await ensureUserProfile("ana@ambiental.sc", undefined, store)).toBe("existing");
  });

  test("also recognizes the string form of the already-exists error code", async () => {
    const store = fakeStore({
      create: async () => {
        throw Object.assign(new Error("already exists"), { code: "already-exists" });
      },
    });
    expect(await ensureUserProfile("ana@ambiental.sc", undefined, store)).toBe("existing");
  });

  test("reports an existing profile that an admin blocked, so no token is issued", async () => {
    const store = fakeStore({
      create: async () => {
        throw alreadyExists();
      },
      isAuthorized: async () => false,
    });
    expect(await ensureUserProfile("ana@ambiental.sc", undefined, store)).toBe("blocked");
  });

  test("propagates any other Firestore error", async () => {
    const store = fakeStore({
      create: async () => {
        throw Object.assign(new Error("unavailable"), { code: 14 });
      },
    });
    await expect(ensureUserProfile("ana@ambiental.sc", undefined, store)).rejects.toThrow("unavailable");
  });

  test("refuses e-mails outside the allowed pattern without touching Firestore", async () => {
    const store = fakeStore();
    await expect(ensureUserProfile("ana@gmail.com", undefined, store)).rejects.toThrow();
    expect(store.created).toHaveLength(0);
  });
});
