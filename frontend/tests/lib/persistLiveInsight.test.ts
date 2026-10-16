import { beforeEach, describe, expect, test } from "bun:test";

import { INSIGHT_MIN_NEW_SEGMENTS, INSIGHT_MIN_SEGMENTS } from "../../src/lib/insight-schedule";
import { liveInsightStore } from "../../src/lib/liveInsightStore";
import { persistLiveInsight } from "../../src/lib/persistLiveInsight";
import type { LiveInsightData } from "../../src/types";

function makeInsight(label: string): LiveInsightData {
  return {
    summary: [label],
    topic: { title: "t", bullets: [], explanation: "" },
    questions: [],
    actions: [],
    attention_points: [],
    keywords: [],
  };
}

describe("persistLiveInsight", () => {
  let session: number;
  let saved: Array<[string, LiveInsightData]>;
  let regenerations: number;

  const save = async (id: string, insight: LiveInsightData) => {
    saved.push([id, insight]);
  };
  const regenerate = (label = "final") => async () => {
    regenerations += 1;
    return makeInsight(label);
  };

  beforeEach(() => {
    session = liveInsightStore.startSession();
    saved = [];
    regenerations = 0;
  });

  test("saves the stored insight as is when it already covers the whole transcript", async () => {
    const periodic = makeInsight("periodic");
    liveInsightStore.set(periodic, session, 20);

    const result = await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: 20 + INSIGHT_MIN_NEW_SEGMENTS - 1,
      save,
      regenerate: regenerate(),
    });

    expect(result).toBe(true);
    expect(regenerations).toBe(0);
    expect(saved).toEqual([["m1", periodic]]);
  });

  test("generates a final insight when the stored one misses the end of the recording", async () => {
    liveInsightStore.set(makeInsight("periodic"), session, 20);

    await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: 20 + INSIGHT_MIN_NEW_SEGMENTS,
      save,
      regenerate: regenerate(),
    });

    expect(regenerations).toBe(1);
    expect(saved[0][1].summary).toEqual(["final"]);
  });

  test("generates the insight when none was ever produced but the meeting is long enough", async () => {
    await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: INSIGHT_MIN_SEGMENTS,
      save,
      regenerate: regenerate(),
    });

    expect(saved[0][1].summary).toEqual(["final"]);
  });

  test("keeps the periodic insight when the final generation fails", async () => {
    const periodic = makeInsight("periodic");
    liveInsightStore.set(periodic, session, 10);

    const result = await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: 40,
      save,
      regenerate: async () => {
        throw new Error("modelo fora do ar");
      },
    });

    expect(result).toBe(true);
    expect(saved).toEqual([["m1", periodic]]);
  });

  test("does nothing for a short meeting without any insight", async () => {
    const result = await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: INSIGHT_MIN_SEGMENTS - 1,
      save,
      regenerate: regenerate(),
    });

    expect(result).toBe(false);
    expect(regenerations).toBe(0);
    expect(saved).toEqual([]);
  });

  test("waits for the periodic generation that is still running", async () => {
    liveInsightStore.track(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          liveInsightStore.set(makeInsight("late-periodic"), session, 30);
          resolve();
        }, 10)
      )
    );

    await persistLiveInsight({ meetingId: "m1", session, totalSegments: 30, save, regenerate: regenerate() });

    expect(regenerations).toBe(0);
    expect(saved[0][1].summary).toEqual(["late-periodic"]);
  });

  test("does not attach a newer recording insight to an older meeting", async () => {
    const old = session;
    const next = liveInsightStore.startSession();
    liveInsightStore.set(makeInsight("new"), next, 30);

    const result = await persistLiveInsight({
      meetingId: "old-meeting",
      session: old,
      totalSegments: 3,
      save,
      regenerate: regenerate(),
    });

    expect(result).toBe(false);
    expect(saved).toEqual([]);
    expect(liveInsightStore.take(next)?.insight.summary).toEqual(["new"]);
  });

  test("swallows save failures so the meeting flow is never affected", async () => {
    liveInsightStore.set(makeInsight("periodic"), session, 20);

    const result = await persistLiveInsight({
      meetingId: "m1",
      session,
      totalSegments: 20,
      save: async () => {
        throw new Error("disk full");
      },
      regenerate: regenerate(),
    });

    expect(result).toBe(false);
  });
});
