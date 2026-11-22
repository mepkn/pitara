import { describe, expect, test } from "vitest";
import { bareHost, isBlockedAddress, isIpLiteral, parseIpv4, parseIpv6 } from "./ssrf";

describe("isBlockedAddress", () => {
  test.each([
    // IPv4: private, loopback, link-local, CGNAT / Tailscale, metadata, reserved
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.255.255.254",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255",
    "100.64.0.1", "100.100.100.100", "100.127.255.255", "192.0.0.1", "192.0.2.5", "198.18.0.1",
    "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.255", "240.0.0.1",
    "255.255.255.255",
    // IPv6
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "::ffff:192.168.1.1",
    "0:0:0:0:0:ffff:7f00:1", "64:ff9b::7f00:1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2002:7f00:1::1", "::127.0.0.1", "1::1",
    // not an address at all fails closed
    "", "localhost", "example.com", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.04x", "::g", "1::2::3", "[::1]",
  ])("%s is blocked", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  test.each([
    "1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.1", "172.15.255.255",
    "172.32.0.1", "192.167.1.1", "192.169.0.1", "198.17.0.1", "198.20.0.1", "223.255.255.255",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81c::200e", "::ffff:8.8.8.8",
    "::ffff:808:808",
  ])("%s is allowed", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("parsing", () => {
  test("IPv4", () => {
    expect(parseIpv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseIpv4("01.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseIpv4("1.2.3")).toBeNull();
    expect(parseIpv4("a.b.c.d")).toBeNull();
  });

  test("IPv6", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("2001:db8::ff00:42:8329")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
    expect(parseIpv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIpv6("1:2:3:4:5:6:1.2.3.4")).toEqual([1, 2, 3, 4, 5, 6, 0x0102, 0x0304]);
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIpv6("12345::")).toBeNull();
    expect(parseIpv6("example")).toBeNull();
  });

  test("host helpers", () => {
    expect(bareHost("[::1]")).toBe("::1");
    expect(bareHost("Example.COM.")).toBe("example.com");
    expect(isIpLiteral("1.2.3.4")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });

  test("the URL parser turns tricky IPv4 spellings into dotted form, which is then judged", () => {
    for (const host of ["2130706433", "0x7f.1", "0177.0.0.1", "127.1", "0x7f000001"]) {
      const { hostname } = new URL(`http://${host}/`);
      expect(isBlockedAddress(hostname), host).toBe(true);
    }
  });
});
