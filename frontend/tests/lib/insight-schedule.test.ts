import { describe, expect, test } from "bun:test";

import {
  INSIGHT_FAILURE_DURATION_MS,
  INSIGHT_MIN_INTERVAL_MS,
  INSIGHT_MIN_NEW_SEGMENTS,
  INSIGHT_MIN_SEGMENTS,
  shouldRunInsight,
  type InsightScheduleState,
} from "../../src/lib/insight-schedule";

const base: InsightScheduleState = {
  segmentCount: 0,
  analyzedCount: 0,
  isGenerating: false,
  lastRunEndedAt: null,
  lastDurationMs: null,
  now: 1_000_000,
};

describe("shouldRunInsight", () => {
  test("waits until there are enough segments", () => {
    expect(shouldRunInsight({ ...base, segmentCount: INSIGHT_MIN_SEGMENTS - 1 })).toBe(false);
  });

  test("runs the first insight immediately once the minimum is reached", () => {
    expect(shouldRunInsight({ ...base, segmentCount: INSIGHT_MIN_SEGMENTS })).toBe(true);
  });

  test("a failed first attempt is retried only after resting", () => {
    const failed = {
      ...base,
      segmentCount: INSIGHT_MIN_SEGMENTS,
      lastDurationMs: INSIGHT_FAILURE_DURATION_MS,
      lastRunEndedAt: base.now - 5_000,
    };

    expect(shouldRunInsight(failed)).toBe(false);
    expect(shouldRunInsight({ ...failed, lastRunEndedAt: base.now - 31_000 })).toBe(true);
  });

  test("never overlaps two generations", () => {
    expect(
      shouldRunInsight({ ...base, segmentCount: 50, isGenerating: true })
    ).toBe(false);
  });

  test("needs new speech before refreshing", () => {
    const state = {
      ...base,
      segmentCount: 10 + INSIGHT_MIN_NEW_SEGMENTS - 1,
      analyzedCount: 10,
      lastRunEndedAt: base.now - 60_000,
      lastDurationMs: 2_000,
    };

    expect(shouldRunInsight(state)).toBe(false);
    expect(shouldRunInsight({ ...state, segmentCount: state.segmentCount + 1 })).toBe(true);
  });

  test("respects the minimum interval between runs", () => {
    const state = {
      ...base,
      segmentCount: 20,
      analyzedCount: 10,
      lastDurationMs: 1_000,
      lastRunEndedAt: base.now - (INSIGHT_MIN_INTERVAL_MS - 1),
    };

    expect(shouldRunInsight(state)).toBe(false);
    expect(shouldRunInsight({ ...state, lastRunEndedAt: base.now - INSIGHT_MIN_INTERVAL_MS })).toBe(
      true
    );
  });

  test("rests longer after a slow run so local models do not hog the machine", () => {
    const state = {
      ...base,
      segmentCount: 20,
      analyzedCount: 10,
      lastDurationMs: 30_000,
      lastRunEndedAt: base.now - 40_000,
    };

    expect(shouldRunInsight(state)).toBe(false);
    expect(shouldRunInsight({ ...state, lastRunEndedAt: base.now - 60_000 })).toBe(true);
  });
});
