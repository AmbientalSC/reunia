import { describe, expect, mock, test } from "bun:test";

mock.module("@/config/firebase", () => ({ functions: {} }));
mock.module("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: [] }) }));

const { computeAudioSeconds, createUsageReporter, claimAccessReport, releaseAccessReport } = await import(
  "../../src/lib/usageTracking"
);

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("claimAccessReport", () => {
  test("lets the first call for a uid through and blocks repeats, like the hourly token refresh", () => {
    const storage = fakeStorage();
    expect(claimAccessReport("msft:a", storage)).toBe(true);
    expect(claimAccessReport("msft:a", storage)).toBe(false);
  });

  test("survives a webview reload because it lives in the storage, not in memory", () => {
    const storage = fakeStorage();
    claimAccessReport("msft:a", storage);
    // A reload re-evaluates the module but keeps sessionStorage: a fresh claim against the same storage.
    expect(claimAccessReport("msft:a", storage)).toBe(false);
  });

  test("counts a different user on the same machine", () => {
    const storage = fakeStorage();
    claimAccessReport("msft:a", storage);
    expect(claimAccessReport("msft:b", storage)).toBe(true);
  });

  test("counts a new login after the previous one was released on logout", () => {
    const storage = fakeStorage();
    claimAccessReport("msft:a", storage);
    releaseAccessReport(storage);
    expect(claimAccessReport("msft:a", storage)).toBe(true);
  });

  test("still works when the storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(claimAccessReport("msft:z", broken)).toBe(true);
    expect(claimAccessReport("msft:z", broken)).toBe(false);
    releaseAccessReport(broken);
    expect(claimAccessReport("msft:z", broken)).toBe(true);
  });
});

describe("computeAudioSeconds", () => {
  test("uses the latest audio_end_time, i.e. how long the recording ran", () => {
    expect(
      computeAudioSeconds([
        { audio_end_time: 30.4, duration: 30.4 },
        { audio_end_time: 125.2, duration: 40 },
        { audio_end_time: 80, duration: 10 },
      ])
    ).toBe(125);
  });

  test("falls back to the sum of durations when end times are missing", () => {
    expect(computeAudioSeconds([{ duration: 10 }, { duration: 20.4 }])).toBe(30);
  });

  test("returns 0 for no segments and ignores invalid numbers", () => {
    expect(computeAudioSeconds([])).toBe(0);
    expect(computeAudioSeconds([{ audio_end_time: Number.NaN, duration: -5 }])).toBe(0);
  });
});

describe("createUsageReporter", () => {
  test("sends the event and the audio seconds", async () => {
    const calls: unknown[] = [];
    const report = createUsageReporter(async (payload) => {
      calls.push(payload);
    });

    await report("meeting", 90);
    await report("summary");

    expect(calls).toEqual([{ event: "meeting", audioSeconds: 90 }, { event: "summary", audioSeconds: undefined }]);
  });

  test("drops a non-finite audio length instead of getting the whole event rejected", async () => {
    const calls: unknown[] = [];
    const report = createUsageReporter(async (payload) => {
      calls.push(payload);
    });

    await report("meeting", Number.NaN);
    // The backend serializes NaN as null, which is what the import-complete payload can carry.
    await report("meeting", null as unknown as number);

    expect(calls).toEqual([
      { event: "meeting", audioSeconds: undefined },
      { event: "meeting", audioSeconds: undefined },
    ]);
  });

  test("never rejects when the server call fails, so usage reporting cannot break the app", async () => {
    const report = createUsageReporter(async () => {
      throw new Error("offline");
    });

    await expect(report("access")).resolves.toBeUndefined();
  });

  test("never throws synchronously either", async () => {
    const report = createUsageReporter(() => {
      throw new Error("callable not ready");
    });

    await expect(report("access")).resolves.toBeUndefined();
  });
});
