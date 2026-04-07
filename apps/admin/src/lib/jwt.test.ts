import { describe, expect, it, beforeAll } from "vitest";

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
