import { describe, expect, it } from "vitest";
import { UNKNOWN_IP_KEY, clientIpKey, normalizeIp } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpKey (R-41)", () => {
  it("x-forwarded-for의 첫 값을 쓴다(공백 무시)", () => {
    expect(clientIpKey(h({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("x-forwarded-for가 없으면 x-real-ip", () => {
    expect(clientIpKey(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("헤더가 없거나 IP 형식이 아니면 모두 한 키(unknown)", () => {
    expect(UNKNOWN_IP_KEY).toBe("unknown");
    expect(clientIpKey(h({}))).toBe("unknown");
    expect(clientIpKey(h({ "x-forwarded-for": "evil" }))).toBe("unknown");
    expect(clientIpKey(h({ "x-forwarded-for": "", "x-real-ip": "1.2.3.256" }))).toBe("unknown");
  });
});

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7:5123", "203.0.113.7"],
    ["010.000.001.002", "10.0.1.2"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:CB00:7107", "203.0.113.7"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:0001:0002::1", "2001:db8:1:2::/64"],
    ["[2001:db8:1:2::9]:443", "2001:db8:1:2::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
  ])("%s → %s", (raw, key) => {
    expect(normalizeIp(raw)).toBe(key);
  });

  it("같은 /64 안의 IPv6는 같은 키, 다른 /64는 다른 키", () => {
    expect(normalizeIp("2001:db8:1:2::a")).toBe(normalizeIp("2001:db8:1:2:ffff::b"));
    expect(normalizeIp("2001:db8:1:3::a")).not.toBe(normalizeIp("2001:db8:1:2::a"));
  });

  it.each([
    "1.2.3",
    "1.2.3.4.5",
    "1.2.3.256",
    "1::2::3",
    "12345::",
    "1:2:3:4:5:6:7:8:9",
    "abc",
    "",
  ])("형식이 아니면 null: %s", (raw) => {
    expect(normalizeIp(raw)).toBeNull();
  });
});
