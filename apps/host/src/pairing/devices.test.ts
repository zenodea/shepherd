import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { relayCredential } from "@shepherd/protocol";
import { loadOrCreateStoredConfig } from "../system/config.ts";
import { DeviceRegistry, PAIRING_TTL_MS, hashToken } from "./devices.ts";
import { until } from "../testing/fake-herdr.ts";

const dirs: string[] = [];
function freshConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "shepherd-devices-"));
  dirs.push(dir);
  const path = join(dir, "host.json");
  loadOrCreateStoredConfig(path);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DeviceRegistry", () => {
  it("redeems a pairing code once for a new device token", () => {
    const registry = new DeviceRegistry(freshConfig());
    const { code } = registry.createPairing();

    const paired = registry.authenticate(code, "Pixel 8");
    expect(paired).toMatchObject({ ok: true, device: { name: "Pixel 8" } });
    if (!paired.ok) throw new Error();
    expect(paired.issuedToken).toBeTruthy();
    expect(registry.list()).toHaveLength(1);

    expect(registry.authenticate(code, "Someone else")).toEqual({ ok: false, reason: "expired" });
    expect(registry.authenticate(paired.issuedToken!, "Pixel 8")).toMatchObject({ ok: true, device: { id: paired.device.id } });
    expect(registry.authenticate(paired.issuedToken!, "x")).not.toHaveProperty("issuedToken");
  });

  it("rejects the relay credential used as a token (a relay operator replaying what it saw)", () => {
    const registry = new DeviceRegistry(freshConfig());
    const paired = registry.authenticate(registry.createPairing().code, "phone");
    if (!paired.ok) throw new Error();
    expect(registry.authenticate(relayCredential(paired.issuedToken!), "relay")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects expired codes and unknown tokens", () => {
    let now = 1_000_000;
    const registry = new DeviceRegistry(freshConfig(), { now: () => now });
    const { code } = registry.createPairing();
    now += PAIRING_TTL_MS + 1;
    expect(registry.authenticate(code, "late")).toEqual({ ok: false, reason: "expired" });
    expect(registry.authenticate("nope", "x")).toEqual({ ok: false, reason: "invalid" });
    expect(registry.list()).toEqual([]);
  });

  it("never stores tokens or codes in plain text", () => {
    const path = freshConfig();
    const registry = new DeviceRegistry(path);
    const { code } = registry.createPairing();
    const paired = registry.authenticate(code, "Pixel");
    const file = readFileSync(path, "utf8");
    expect(file).not.toContain(code);
    if (!paired.ok) throw new Error();
    expect(file).not.toContain(paired.issuedToken!);
    expect(file).toContain(hashToken(paired.issuedToken!));
  });

  it("lists hashes the relay should admit: devices and live pairing codes", () => {
    let now = 5_000_000;
    const registry = new DeviceRegistry(freshConfig(), { now: () => now });
    const first = registry.createPairing();
    const paired = registry.authenticate(first.code, "a");
    const pending = registry.createPairing();
    if (!paired.ok) throw new Error();
    // The relay sees relayCredential(token) = sha256(token) and compares its SHA-256 with these.
    const twice = (t: string) => hashToken(relayCredential(t));
    expect(registry.clientTokenHashes().sort()).toEqual([twice(paired.issuedToken!), twice(pending.code)].sort());
    now += PAIRING_TTL_MS + 1;
    expect(registry.clientTokenHashes()).toEqual([twice(paired.issuedToken!)]);
  });

  it("revokes devices and tells listeners", () => {
    const registry = new DeviceRegistry(freshConfig());
    const a = registry.authenticate(registry.createPairing().code, "a");
    registry.authenticate(registry.createPairing().code, "b");
    if (!a.ok) throw new Error();
    let changes = 0;
    registry.on("changed", () => changes++);
    expect(registry.revoke(a.device.id)).toBe(1);
    expect(registry.list().map((d) => d.name)).toEqual(["b"]);
    expect(changes).toBe(1);
    expect(registry.authenticate(a.issuedToken!, "a")).toEqual({ ok: false, reason: "invalid" });
    expect(registry.revoke("all")).toBe(1);
    expect(registry.revoke("missing")).toBe(0);
  });

  it("accepts a pairing code created by another process a moment ago", () => {
    const path = freshConfig();
    const host = new DeviceRegistry(path);
    const { code } = new DeviceRegistry(path).createPairing();
    expect(host.authenticate(code, "quick")).toMatchObject({ ok: true });
  });

  it("sees changes made by another process (the CLI)", async () => {
    const path = freshConfig();
    const host = new DeviceRegistry(path);
    host.watch(20);
    const paired = host.authenticate(host.createPairing().code, "phone");
    if (!paired.ok) throw new Error();
    let changed = false;
    host.on("changed", () => (changed = true));
    // Let the watcher take its first reading of the file (it's async), or the
    // change below can land before it and never look like a change.
    await new Promise((resolve) => setTimeout(resolve, 150));

    new DeviceRegistry(path).revoke(paired.device.id);
    await until(() => changed, 3000);
    expect(host.get(paired.device.id)).toBeNull();
    host.unwatch();
  });

  it("keeps the devices it knows when the file is half-written", async () => {
    const path = freshConfig();
    const host = new DeviceRegistry(path);
    const paired = host.authenticate(host.createPairing().code, "phone");
    if (!paired.ok) throw new Error();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    host.watch(20);
    await new Promise((resolve) => setTimeout(resolve, 150));
    writeFileSync(path, "{ not json");
    await until(() => errors.mock.calls.length > 0, 3000);
    expect(host.get(paired.device.id)).not.toBeNull();
    host.unwatch();
    errors.mockRestore();
  });
});

describe("config migration", () => {
  it("gives configs from before encryption a host key", () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-migrate-"));
    dirs.push(dir);
    const path = join(dir, "host.json");
    writeFileSync(path, JSON.stringify({ hostId: "h", name: "laptop", devices: [] }));
    expect(loadOrCreateStoredConfig(path).hostKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(readFileSync(path, "utf8")).hostKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("turns the old shared token into a revocable device", () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-migrate-"));
    dirs.push(dir);
    const path = join(dir, "host.json");
    writeFileSync(path, JSON.stringify({ hostId: "h", name: "laptop", token: "old-shared-token" }));
    const cfg = loadOrCreateStoredConfig(path);
    expect(cfg.token).toBeUndefined();
    expect(cfg.devices).toMatchObject([{ id: "legacy", tokenHash: hashToken("old-shared-token") }]);
    expect(new DeviceRegistry(path).authenticate("old-shared-token", "x")).toMatchObject({ ok: true, device: { id: "legacy" } });
  });
});
