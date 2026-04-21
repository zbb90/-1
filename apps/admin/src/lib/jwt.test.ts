import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("jwt", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "unit-test-jwt-secret-key!!";
  });

  it("signs and verifies a token", async () => {
    const { signJwt, verifyJwt } = await import("./jwt");
    const token = await signJwt({
      sub: "openid-test",
      role: "specialist",
      name: "测试",
    });
    const payload = await verifyJwt(token);
    expect(payload?.sub).toBe("openid-test");
    expect(payload?.role).toBe("specialist");
  });

  it("rejects tampered token", async () => {
    const { signJwt, verifyJwt } = await import("./jwt");
    const token = await signJwt({ sub: "a", role: "specialist" });
    const bad = token.slice(0, -4) + "xxxx";
    expect(await verifyJwt(bad)).toBeNull();
  });
});

describe("jwt env validation", () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalExpires = process.env.JWT_EXPIRES_SECONDS;
  const originalNodeEnv = process.env.NODE_ENV;

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  beforeEach(() => {
    restoreEnv("JWT_SECRET", originalSecret);
    restoreEnv("JWT_EXPIRES_SECONDS", originalExpires);
    restoreEnv("NODE_ENV", originalNodeEnv);
  });

  afterEach(() => {
    restoreEnv("JWT_SECRET", originalSecret);
    restoreEnv("JWT_EXPIRES_SECONDS", originalExpires);
    restoreEnv("NODE_ENV", originalNodeEnv);
  });

  it("rejects short JWT_SECRET in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "short-secret-only-16x";
    const { signJwt } = await import("./jwt");
    await expect(signJwt({ sub: "a", role: "specialist" })).rejects.toThrow(
      /at least 32 characters/i,
    );
  });

  it("rejects non-numeric JWT_EXPIRES_SECONDS instead of silently falling back", async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "unit-test-jwt-secret-key!!";
    process.env.JWT_EXPIRES_SECONDS = "not-a-number";
    const { signJwt } = await import("./jwt");
    await expect(signJwt({ sub: "a", role: "specialist" })).rejects.toThrow(
      /JWT_EXPIRES_SECONDS/,
    );
  });

  it("rejects out-of-range JWT_EXPIRES_SECONDS", async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "unit-test-jwt-secret-key!!";
    process.env.JWT_EXPIRES_SECONDS = "10";
    const { signJwt } = await import("./jwt");
    await expect(signJwt({ sub: "a", role: "specialist" })).rejects.toThrow(
      /JWT_EXPIRES_SECONDS/,
    );
  });
});
