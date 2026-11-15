import {
  decodeHxOcAttempt,
  decodeHxOcCatalog,
  decodeHxOcCompleteInput,
  decodeHxOcDisconnectInput,
  decodeHxOcKeyInput,
  decodeHxOcMethodInput,
  HX_OC_KEY_MAX,
} from "@hxbot/contracts/hx-opencode";
import { describe, expect, it } from "vitest";

// Main receives these from the screen: anything outside the shape is refused before OpenCode sees it.
describe("OpenCode connection inputs", () => {
  it("takes a key and trims it", () => {
    expect(decodeHxOcKeyInput({ integrationId: "deepseek", key: "  sk-1  ", answer: null })).toEqual({
      integrationId: "deepseek",
      key: "sk-1",
      answer: null,
    });
  });

  it("refuses an id that is not an OpenCode id", () => {
    for (const integrationId of ["", "../credential", "a/b", "x".repeat(200), 3])
      expect(() => decodeHxOcKeyInput({ integrationId, key: "k" })).toThrow();
    expect(() => decodeHxOcDisconnectInput({ integrationId: "deepseek", credentialId: "a b" })).toThrow();
  });

  it("refuses an empty, long or multi-line key", () => {
    for (const key of ["", "   ", "a\nb", "x".repeat(HX_OC_KEY_MAX + 1), 5])
      expect(() => decodeHxOcKeyInput({ integrationId: "deepseek", key })).toThrow();
  });

  it("refuses form answers of the wrong shape", () => {
    expect(() =>
      decodeHxOcMethodInput({ integrationId: "gitlab", methodId: "pkce", answer: { url: { nested: true } } }),
    ).toThrow();
    expect(() =>
      decodeHxOcMethodInput({ integrationId: "gitlab", methodId: "pkce", answer: { "bad key": "x" } }),
    ).toThrow();
    expect(
      decodeHxOcMethodInput({
        integrationId: "gitlab",
        methodId: "pkce",
        answer: { instanceUrl: "https://g", on: true },
      }).answer,
    ).toEqual({ instanceUrl: "https://g", on: true });
  });

  it("takes an empty code as no code", () => {
    expect(decodeHxOcCompleteInput({ integrationId: "openai", attemptId: "con_1", code: "  " }).code).toBeNull();
    expect(decodeHxOcCompleteInput({ integrationId: "openai", attemptId: "con_1", code: " ab " }).code).toBe("ab");
  });
});

// The screen receives these from main.
describe("OpenCode connection answers", () => {
  it("accepts a catalog and refuses a broken one", () => {
    const catalog = { state: "ready", version: "2.2.5", message: null, integrations: [], freeModels: 8, models: {} };
    expect(decodeHxOcCatalog(catalog)).toEqual(catalog);
    expect(() => decodeHxOcCatalog({ ...catalog, state: "other" })).toThrow();
    expect(() => decodeHxOcCatalog({ ...catalog, integrations: [{ id: "x" }] })).toThrow();
  });

  it("refuses an attempt with no page", () => {
    expect(() =>
      decodeHxOcAttempt({ integrationId: "openai", attemptId: "c", instructions: "", mode: "auto", expiresAt: 1 }),
    ).toThrow();
  });
});
