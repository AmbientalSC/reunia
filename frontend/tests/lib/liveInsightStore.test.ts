import { beforeEach, describe, expect, test } from "bun:test";

import { liveInsightStore } from "../../src/lib/liveInsightStore";
import type { LiveInsightData } from "../../src/types";

const insight: LiveInsightData = {
  summary: ["a"],
  topic: { title: "t", bullets: [], explanation: "" },
  questions: [],
  actions: [],
  attention_points: [],
  keywords: ["LGPD"],
};

describe("liveInsightStore", () => {
  let session: number;

  beforeEach(() => {
    session = liveInsightStore.startSession();
  });

  test("returns nothing when empty", () => {
    expect(liveInsightStore.take(session)).toBeNull();
  });

  test("take returns the stored insight with its coverage once and then empties the store", () => {
    liveInsightStore.set(insight, session, 12);

    expect(liveInsightStore.take(session)).toEqual({ insight, analyzedSegments: 12 });
    expect(liveInsightStore.take(session)).toBeNull();
  });

  test("a newer insight replaces the previous one", () => {
    liveInsightStore.set(insight, session, 6);
    liveInsightStore.set({ ...insight, summary: ["b"] }, session, 10);

    const stored = liveInsightStore.take(session);
    expect(stored?.insight.summary).toEqual(["b"]);
    expect(stored?.analyzedSegments).toBe(10);
  });

  test("starting a new session discards the previous insight", () => {
    liveInsightStore.set(insight, session, 6);
    const next = liveInsightStore.startSession();

    expect(liveInsightStore.take(next)).toBeNull();
  });

  test("a generation that finishes after its session ended is ignored", () => {
    const old = session;
    const next = liveInsightStore.startSession();

    liveInsightStore.set(insight, old, 150);

    expect(liveInsightStore.take(next)).toBeNull();
  });

  test("a late save from an old session never receives the new recording insight", () => {
    const old = session;
    const next = liveInsightStore.startSession();
    liveInsightStore.set(insight, next, 7);

    expect(liveInsightStore.take(old)).toBeNull();
    expect(liveInsightStore.take(next)?.insight).toEqual(insight);
  });

  test("settled waits for the tracked generation, even when it fails", async () => {
    let finished = false;
    liveInsightStore.track(
      new Promise((_, reject) =>
        setTimeout(() => {
          finished = true;
          reject(new Error("falhou"));
        }, 10)
      )
    );

    await liveInsightStore.settled();

    expect(finished).toBe(true);
  });

  test("settled resolves immediately when nothing is running", async () => {
    await liveInsightStore.settled();
  });
});
