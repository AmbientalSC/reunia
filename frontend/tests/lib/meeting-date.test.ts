import { describe, expect, test } from "bun:test";

import { formatMeetingDate } from "../../src/lib/meeting-date";

// Local-time constructors keep these tests independent of the machine's time zone.
describe("formatMeetingDate", () => {
  test("formats a date as 'D de mês de AAAA' in Portuguese", () => {
    expect(formatMeetingDate(new Date(2026, 9, 16, 12))).toBe("16 de outubro de 2026");
  });

  test("uses the ordinal for the first day of the month", () => {
    expect(formatMeetingDate(new Date(2027, 0, 1, 12))).toBe("1º de janeiro de 2027");
  });

  test("does not zero-pad other single-digit days", () => {
    expect(formatMeetingDate(new Date(2026, 2, 5, 12))).toBe("5 de março de 2026");
  });

  test("accepts ISO strings", () => {
    const iso = new Date(2026, 9, 16, 12).toISOString();

    expect(formatMeetingDate(iso)).toBe("16 de outubro de 2026");
  });

  test("falls back to today for missing or invalid input", () => {
    const today = formatMeetingDate(new Date());

    expect(formatMeetingDate(undefined)).toBe(today);
    expect(formatMeetingDate(null)).toBe(today);
    expect(formatMeetingDate("not a date")).toBe(today);
  });
});
