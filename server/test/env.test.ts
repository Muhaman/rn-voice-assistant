import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

describe("loadEnv", () => {
  it("throws naming ANTHROPIC_API_KEY when it is missing", () => {
    expect(() => loadEnv({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws naming ANTHROPIC_API_KEY when it is empty", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("applies defaults", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "k" });
    expect(env).toMatchObject({ ANTHROPIC_MODEL: "claude-opus-5-5", PORT: 3000, LOG_LEVEL: "info", corsOrigins: [] });
  });

  it("reads the model, port and CORS allowlist", () => {
    const env = loadEnv({
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_MODEL: "claude-sonnet-5-5",
      PORT: "8080",
      CORS_ORIGINS: "http://a.test, http://b.test",
    });
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(env.PORT).toBe(8080);
    expect(env.corsOrigins).toEqual(["http://a.test", "http://b.test"]);
  });
});
