import { describe, expect, test } from "bun:test";
import { FieldValue } from "firebase-admin/firestore";

const { parseUsageRequest, buildUsageUpdate, MAX_AUDIO_SECONDS_PER_EVENT } = await import("../src/usage");

describe("parseUsageRequest", () => {
  test("accepts the three known events", () => {
    expect(parseUsageRequest({ event: "access" }).event).toBe("access");
    expect(parseUsageRequest({ event: "summary" }).event).toBe("summary");
    expect(parseUsageRequest({ event: "meeting", audioSeconds: 90 })).toEqual({ event: "meeting", audioSeconds: 90 });
  });

  test("rejects unknown events and malformed payloads", () => {
    expect(() => parseUsageRequest({ event: "delete_everything" })).toThrow();
    expect(() => parseUsageRequest({})).toThrow();
    expect(() => parseUsageRequest(null)).toThrow();
    expect(() => parseUsageRequest("meeting")).toThrow();
  });

  test("defaults audioSeconds to zero when a meeting does not send it", () => {
    expect(parseUsageRequest({ event: "meeting" }).audioSeconds).toBe(0);
  });

  test("rounds audioSeconds to whole seconds", () => {
    expect(parseUsageRequest({ event: "meeting", audioSeconds: 12.6 }).audioSeconds).toBe(13);
  });

  test("rejects negative, non-finite and non-numeric audioSeconds", () => {
    expect(() => parseUsageRequest({ event: "meeting", audioSeconds: -1 })).toThrow();
    expect(() => parseUsageRequest({ event: "meeting", audioSeconds: Number.NaN })).toThrow();
    expect(() => parseUsageRequest({ event: "meeting", audioSeconds: Infinity })).toThrow();
    expect(() => parseUsageRequest({ event: "meeting", audioSeconds: "60" })).toThrow();
  });

  test("clamps absurd audioSeconds to the per-event ceiling", () => {
    expect(parseUsageRequest({ event: "meeting", audioSeconds: 10 ** 9 }).audioSeconds).toBe(
      MAX_AUDIO_SECONDS_PER_EVENT
    );
  });

  test("ignores audioSeconds on events that do not record audio", () => {
    expect(parseUsageRequest({ event: "summary", audioSeconds: 500 }).audioSeconds).toBe(0);
    expect(parseUsageRequest({ event: "access", audioSeconds: 500 }).audioSeconds).toBe(0);
  });
});

describe("buildUsageUpdate", () => {
  test("access bumps the open counter and last access time", () => {
    const update = buildUsageUpdate({ event: "access", audioSeconds: 0 });
    expect(Object.keys(update).sort()).toEqual(["accessCount", "lastAccessAt"]);
    expect(update.accessCount).toBeInstanceOf(FieldValue);
    expect(update.lastAccessAt).toBeInstanceOf(FieldValue);
  });

  test("meeting bumps meetings and audio seconds under usage.* using dotted paths", () => {
    const update = buildUsageUpdate({ event: "meeting", audioSeconds: 600 });
    expect(Object.keys(update).sort()).toEqual(["usage.audioSeconds", "usage.meetingsCount"]);
  });

  test("summary bumps only the summaries counter", () => {
    const update = buildUsageUpdate({ event: "summary", audioSeconds: 0 });
    expect(Object.keys(update)).toEqual(["usage.summariesCount"]);
  });

  test("never touches authorization, role or the Groq key", () => {
    for (const event of ["access", "meeting", "summary"] as const) {
      const keys = Object.keys(buildUsageUpdate({ event, audioSeconds: 1 }));
      expect(keys).not.toContain("authorized");
      expect(keys).not.toContain("role");
      expect(keys).not.toContain("groqApiKey");
    }
  });
});
