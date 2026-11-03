import { describe, expect, it } from "vitest";
import { hashPin, isPinFormat, verifyPin } from "./pin";

describe("isPinFormat (MEMBER-06-01)", () => {
  it.each(["0000", "4827", "9999"])("%s 통과", (pin) => expect(isPinFormat(pin)).toBe(true));

  it.each(["123", "12345", "12a4", " 1234", "１２３４", "", "12.4"])("%j 거절", (pin) =>
    expect(isPinFormat(pin)).toBe(false),
  );
});

describe("hashPin / verifyPin", () => {
  it("scrypt$N$r$p$salt$hash 형식이고 원문을 담지 않는다", async () => {
    const stored = await hashPin("4827");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toContain("4827");
  });

  it("같은 PIN이면 검증에 성공하고 다른 PIN이면 실패한다", async () => {
    const stored = await hashPin("4827");
    expect(await verifyPin("4827", stored)).toBe(true);
    expect(await verifyPin("4828", stored)).toBe(false);
  });

  it("같은 PIN이라도 salt가 달라 해시가 다르다", async () => {
    const [a, b] = await Promise.all([hashPin("0000"), hashPin("0000")]);
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
  });

  it("저장 형식이 깨졌으면 예외 없이 false", async () => {
    expect(await verifyPin("4827", "")).toBe(false);
    expect(await verifyPin("4827", "bcrypt$x")).toBe(false);
    expect(await verifyPin("4827", "scrypt$abc$8$1$salt$hash")).toBe(false);
  });
});
