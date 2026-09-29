import { describe, expect, it } from "vitest";
import { encodePairingLink, normaliseHostUrl, parsePairingLink } from "./pairing.ts";

const info = {
  name: "Zeno's MacBook",
  token: "mHcESZyjRzFjhGBlDaMCPjQbadzEzn8daXOLwnIYyso",
  urls: [
    "ws://192.168.1.20:7420/connect",
    "ws://100.101.102.103:7420/connect",
    "wss://shepherd-relay.example.workers.dev/hosts/6l7uJofGV0Nw/connect",
  ],
};

describe("pairing links", () => {
  it("carries the host key when present", () => {
    const withKey = { ...info, hostKey: "ab".repeat(32) };
    expect(parsePairingLink(encodePairingLink(withKey))).toEqual(withKey);
    expect(parsePairingLink(encodePairingLink(withKey).replace("k=abab", "k=zzab"))).toBeNull();
  });

  it("round-trips", () => {
    expect(parsePairingLink(encodePairingLink(info))).toEqual(info);
  });

  it("keeps URLs compact", () => {
    const link = encodePairingLink(info);
    expect(link).toContain("u=ws://192.168.1.20:7420/connect");
    expect(link.startsWith("shepherd://pair?v=1&")).toBe(true);
  });

  it("accepts Expo Go deep links", () => {
    const link = encodePairingLink(info, "shepherd").replace("shepherd://", "exp://100.101.102.103:8081/--/");
    expect(parsePairingLink(link)).toEqual(info);
  });

  it("rejects other QR codes and incomplete links", () => {
    expect(parsePairingLink("https://example.com")).toBeNull();
    expect(parsePairingLink("hello")).toBeNull();
    expect(parsePairingLink("shepherd://pair?v=1&t=abc")).toBeNull();
    expect(parsePairingLink("shepherd://pair?v=2&t=abc&u=ws://h:1/connect")).toBeNull();
    expect(parsePairingLink("shepherd://pair?v=1&u=ws://h:1/connect")).toBeNull();
    expect(parsePairingLink("shepherd://pair?v=1&t=a&u=%E0%A4%A")).toBeNull();
  });

  it("drops unusable and duplicate URLs", () => {
    expect(parsePairingLink("shepherd://pair?v=1&t=a&u=ftp://x&u=ws://h:1/c&u=ws://h:1/c")).toEqual({
      name: "host",
      token: "a",
      urls: ["ws://h:1/c"],
    });
  });
});

describe("normaliseHostUrl", () => {
  it.each([
    ["192.168.1.5", "ws://192.168.1.5:7420/connect"],
    ["192.168.1.5:9000", "ws://192.168.1.5:9000/connect"],
    ["  ws://host:7420/connect ", "ws://host:7420/connect"],
    ["http://host", "ws://host:7420/connect"],
    ["https://relay.dev/hosts/abc/connect", "wss://relay.dev/hosts/abc/connect"],
    ["wss://relay.dev", "wss://relay.dev/connect"],
  ])("%s → %s", (input, expected) => {
    expect(normaliseHostUrl(input)).toBe(expected);
  });

  it("rejects junk", () => {
    expect(() => normaliseHostUrl("ftp://host")).toThrow();
    expect(() => normaliseHostUrl("")).toThrow();
    expect(() => normaliseHostUrl("two words")).toThrow();
  });
});
