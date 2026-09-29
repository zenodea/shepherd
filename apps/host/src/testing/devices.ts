import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateStoredConfig } from "../system/config.ts";
import { DeviceRegistry } from "../pairing/devices.ts";

/** A registry on a throwaway config file, with one device already paired. */
export function testDevices(opts: { now?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sheperd-devices-"));
  const configPath = join(dir, "host.json");
  loadOrCreateStoredConfig(configPath);
  const registry = new DeviceRegistry(configPath, opts);
  const { code } = registry.createPairing();
  const paired = registry.authenticate(code, "Test phone");
  if (!paired.ok || !paired.issuedToken) throw new Error("test pairing failed");
  return {
    registry,
    configPath,
    token: paired.issuedToken,
    deviceId: paired.device.id,
    cleanup: () => {
      registry.unwatch();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
