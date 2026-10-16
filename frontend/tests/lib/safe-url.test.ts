import { describe, expect, test } from "bun:test";

import { isWebUrl, normalizeWebUrl, webHost } from "../../src/lib/safe-url";

describe("isWebUrl", () => {
  test("accepts http and https links", () => {
    expect(isWebUrl("https://www.gov.br/lgpd")).toBe(true);
    expect(isWebUrl("http://localhost:3000/a?b=1&c=2")).toBe(true);
  });

  test("rejects other schemes, relative paths and garbage", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///C:/Windows/System32/calc.exe",
      "ms-msdt:/id PCWDiagnostic",
      "ftp://example.com",
      "/relative/path",
      "not a url",
      "https://",
      "",
      null,
      undefined,
    ]) {
      expect(isWebUrl(value)).toBe(false);
    }
  });

  test("rejects links with embedded credentials, which disguise the real host", () => {
    expect(isWebUrl("https://www.gov.br@evil.example/")).toBe(false);
    expect(isWebUrl("https://user:pass@example.com/")).toBe(false);
  });

  test("rejects absurdly long URLs", () => {
    expect(isWebUrl(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
  });
});

describe("normalizeWebUrl", () => {
  test("gives the same result for two spellings of one link", () => {
    expect(normalizeWebUrl("https://www.gov.br")).toBe(normalizeWebUrl("https://www.gov.br/"));
    expect(normalizeWebUrl("HTTPS://WWW.GOV.BR/a")).toBe("https://www.gov.br/a");
  });

  test("returns null for anything that is not a safe web link", () => {
    expect(normalizeWebUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebUrl("https://a@evil.example/")).toBeNull();
  });
});

describe("webHost", () => {
  test("returns the host without www", () => {
    expect(webHost("https://www.planalto.gov.br/ccivil_03/x.htm")).toBe("planalto.gov.br");
    expect(webHost("https://sub.exemplo.com:8443/x")).toBe("sub.exemplo.com");
  });

  test("returns null for unsafe input", () => {
    expect(webHost("javascript:alert(1)")).toBeNull();
    expect(webHost(undefined)).toBeNull();
  });
});
