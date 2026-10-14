import { describe, expect, test } from "bun:test";

import {
  buildGroqModelOptions,
  findConfiguredModel,
  modelKey,
  pickDefaultModelKey,
  type ModelOption,
} from "../../src/lib/transcriptionModelSelection";

const whisper: ModelOption = { provider: "whisper", name: "large-v3", displayName: "w", size_mb: 3000 };
const parakeet: ModelOption = { provider: "parakeet", name: "parakeet-v3", displayName: "p", size_mb: 600 };
const groqTurbo: ModelOption = {
  provider: "groq",
  name: "whisper-large-v3-turbo",
  displayName: "g",
  size_mb: 0,
};
const groqV3: ModelOption = { provider: "groq", name: "whisper-large-v3", displayName: "g", size_mb: 0 };

describe("buildGroqModelOptions", () => {
  test("lists the two default Groq models when nothing is configured", () => {
    const names = buildGroqModelOptions(undefined).map((m) => m.name);
    expect(names).toEqual(["whisper-large-v3-turbo", "whisper-large-v3"]);
  });

  test("does not duplicate a configured model that is already a default", () => {
    const names = buildGroqModelOptions({ provider: "groq", model: "whisper-large-v3" }).map((m) => m.name);
    expect(names).toEqual(["whisper-large-v3-turbo", "whisper-large-v3"]);
  });

  test("adds a configured Groq model that is not in the defaults", () => {
    const names = buildGroqModelOptions({ provider: "groq", model: "distil-whisper-large-v3-en" }).map(
      (m) => m.name
    );
    expect(names[0]).toBe("distil-whisper-large-v3-en");
    expect(names).toHaveLength(3);
  });

  test("ignores the configured model when the provider is not Groq", () => {
    const names = buildGroqModelOptions({ provider: "parakeet", model: "parakeet-v3" }).map((m) => m.name);
    expect(names).toHaveLength(2);
  });
});

describe("pickDefaultModelKey", () => {
  test("selects the configured Groq model even when local models are listed first", () => {
    const key = pickDefaultModelKey([whisper, parakeet, groqTurbo, groqV3], {
      provider: "groq",
      model: "whisper-large-v3",
    });
    expect(key).toBe("groq:whisper-large-v3");
  });

  test("maps the saved 'localWhisper' provider to the 'whisper' list provider", () => {
    const key = pickDefaultModelKey([parakeet, whisper], { provider: "localWhisper", model: "large-v3" });
    expect(key).toBe("whisper:large-v3");
  });

  test("falls back to the first model when the configured one is unavailable", () => {
    const key = pickDefaultModelKey([parakeet, groqTurbo], { provider: "localWhisper", model: "large-v3" });
    expect(key).toBe(modelKey(parakeet));
  });

  test("returns an empty key when no model is available", () => {
    expect(pickDefaultModelKey([], { provider: "groq", model: "whisper-large-v3" })).toBe("");
  });
});

describe("findConfiguredModel", () => {
  test("returns undefined for an unsupported saved provider", () => {
    expect(findConfiguredModel([groqTurbo], { provider: "deepgram", model: "nova-2" })).toBeUndefined();
  });
});
