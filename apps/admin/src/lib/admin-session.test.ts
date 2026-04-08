import { beforeEach, describe, expect, it } from "vitest";

describe("admin-session", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET =
      "unit-test-admin-session-secret-should-be-long-enough";
  });

  it("signs and reads a session payload", async () => {
    const {
      getAdminSessionFromCookies,
      signAdminSessionValue,
      verifyAdminSessionCookieValue,
    } = await import("./admin-session");

    const value = await signAdminSessionValue({
      sub: "pc-leader:13800138000",
      role: "leader",
      leaderKind: "primary",
      phone: "13800138000",
      name: "负责人",
    });

    const verified = await verifyAdminSessionCookieValue(value);
    expect(verified).toBe(true);

    const session = await getAdminSessionFromCookies({
      get(name: string) {
        return name === "audit_admin_session" ? { value } : undefined;
      },
    });

    expect(session?.sub).toBe("pc-leader:13800138000");
    expect(session?.role).toBe("leader");
    expect(session?.leaderKind).toBe("primary");
    expect(session?.phone).toBe("13800138000");
  });

  it("rejects tampered session payload", async () => {
    const { signAdminSessionValue, verifyAdminSessionCookieValue } =
      await import("./admin-session");
    const value = await signAdminSessionValue({
      sub: "pc-supervisor:13900139000",
      role: "supervisor",
      leaderKind: "none",
      phone: "13900139000",
      name: "主管",
    });

    const bad = `${value.slice(0, -8)}deadbeef`;
    expect(await verifyAdminSessionCookieValue(bad)).toBe(false);
  });
});
