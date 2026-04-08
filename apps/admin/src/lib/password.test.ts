import { describe, expect, it } from "vitest";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const { hashPassword, isPasswordHash, verifyPassword } = await import("./password");
    const hash = await hashPassword("StrongPass123");

    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword("StrongPass123", hash)).toBe(true);
    expect(await verifyPassword("WrongPass123", hash)).toBe(false);
  });

  it("validates password strength", async () => {
    const { validatePasswordStrength } = await import("./password");
    expect(validatePasswordStrength("1234567")).toBe("密码至少需要 8 位字符。");
    expect(validatePasswordStrength("12345678")).toBeNull();
  });
});
