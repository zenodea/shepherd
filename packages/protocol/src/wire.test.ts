import { describe, expect, it } from "vitest";
import { isPaneId, parseClientMessage } from "./wire.ts";
import { parseHostToRelay, parseRelayToHost } from "./tunnel.ts";

describe("parseClientMessage", () => {
  it("accepts an allowlisted call", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "call", id: "1", method: "agent.prompt", params: { target: "w1:p1", text: "hi" } }),
    );
    expect(msg).toEqual({ type: "call", id: "1", method: "agent.prompt", params: { target: "w1:p1", text: "hi" } });
  });

  it("defaults missing params to an empty object", () => {
    expect(parseClientMessage(JSON.stringify({ type: "call", id: "1", method: "agent.list" }))).toEqual({
      type: "call",
      id: "1",
      method: "agent.list",
      params: {},
    });
  });

  it("accepts host methods", () => {
    expect(parseClientMessage(JSON.stringify({ type: "call", id: "1", method: "shepherd.projects" }))).toMatchObject({
      method: "shepherd.projects",
    });
  });

  it("rejects methods outside the allowlist", () => {
    for (const method of ["pane.run", "server.stop", "plugin.action.invoke", "__proto__", "tab.create", "agent.start", "shepherd.nope"]) {
      expect(parseClientMessage(JSON.stringify({ type: "call", id: "1", method, params: {} }))).toBeNull();
    }
  });

  it("validates terminal.open", () => {
    const ok = { type: "terminal.open", streamId: "s1", paneId: "w9:p2", mode: "observe", cols: 80, rows: 24 };
    expect(parseClientMessage(JSON.stringify(ok))).toEqual(ok);
    expect(parseClientMessage(JSON.stringify({ ...ok, paneId: "--takeover" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...ok, mode: "own" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...ok, cols: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...ok, rows: 2.5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...ok, cols: undefined }))).toBeNull();
    const { cols: _c, rows: _r, ...native } = ok;
    expect(parseClientMessage(JSON.stringify(native))).toEqual(native);
    expect(parseClientMessage(JSON.stringify({ ...ok, render: "lines" }))).toEqual({ ...ok, render: "lines" });
    expect(parseClientMessage(JSON.stringify({ ...ok, render: "pixels" }))).toBeNull();
  });

  it("requires exactly one of text or bytes for terminal.input", () => {
    expect(parseClientMessage(JSON.stringify({ type: "terminal.input", streamId: "s", text: "y" }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "terminal.input", streamId: "s", bytes: "Gw==" }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "terminal.input", streamId: "s", text: "y", bytes: "Gw==" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "terminal.input", streamId: "s" }))).toBeNull();
  });

  it("parses auth and cleans up the device name", () => {
    expect(parseClientMessage(JSON.stringify({ type: "auth", token: "abc", device: { name: " Pixel 8\u0007 " } }))).toEqual({
      type: "auth",
      token: "abc",
      device: { name: "Pixel 8" },
    });
    expect(parseClientMessage(JSON.stringify({ type: "auth", token: "abc" }))).toMatchObject({ device: { name: "Unnamed device" } });
    expect(parseClientMessage(JSON.stringify({ type: "auth", token: "" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "auth", token: "x".repeat(257) }))).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage("[]")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "nope" }))).toBeNull();
  });
});

describe("isPaneId", () => {
  it("accepts herdr ids and rejects flag-like values", () => {
    expect(isPaneId("w9:p2")).toBe(true);
    expect(isPaneId("wC:p1")).toBe(true);
    expect(isPaneId("-p")).toBe(false);
    expect(isPaneId("w1:p1; rm -rf /")).toBe(false);
    expect(isPaneId("")).toBe(false);
  });
});

describe("tunnel messages", () => {
  it("parses dial and registered", () => {
    expect(parseRelayToHost(JSON.stringify({ type: "dial", ticket: "abc" }))).toEqual({ type: "dial", ticket: "abc" });
    expect(parseRelayToHost(JSON.stringify({ type: "registered" }))).toEqual({ type: "registered" });
    expect(parseRelayToHost(JSON.stringify({ type: "dial", ticket: "" }))).toBeNull();
  });

  it("only accepts hex sha-256 client token hashes", () => {
    const hashes = ["a".repeat(64), "b".repeat(64)];
    expect(parseHostToRelay(JSON.stringify({ type: "register", clientTokenHashes: hashes }))).toEqual({
      type: "register",
      clientTokenHashes: hashes,
    });
    expect(parseHostToRelay(JSON.stringify({ type: "register", clientTokenHashes: [] }))).toEqual({
      type: "register",
      clientTokenHashes: [],
    });
    expect(parseHostToRelay(JSON.stringify({ type: "register", clientTokenHashes: ["plain-token"] }))).toBeNull();
    expect(parseHostToRelay(JSON.stringify({ type: "register", clientTokenHash: hashes[0] }))).toBeNull();
  });
});
