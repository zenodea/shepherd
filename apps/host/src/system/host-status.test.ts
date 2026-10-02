import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { until } from "../testing/fake-herdr.ts";
import { HostStatusWriter, readHostStatus } from "./host-status.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("host status", () => {
  it("records connected phones until they disconnect, and only for the running host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-status-"));
    dirs.push(dir);
    const config = join(dir, "host.json");
    const writer = new HostStatusWriter(config, {
      herdr: { version: "0.9.1", socketPath: "/x" },
      port: 7420,
      addresses: [],
      agents: { total: 0, blocked: 0, working: 0 },
      relay: null,
      notify: null,
    });
    expect(readHostStatus(config, process.pid)?.phones).toEqual([]);
    expect(readHostStatus(config, process.pid + 1)).toBeNull();

    const release = writer.connected("d1", "relay");
    await until(() => readHostStatus(config, process.pid)?.phones.length === 1);
    expect(readHostStatus(config, process.pid)?.phones[0]).toMatchObject({ deviceId: "d1", via: "relay" });

    release();
    await until(() => readHostStatus(config, process.pid)?.phones.length === 0);
    writer.clear();
    expect(readHostStatus(config, process.pid)).toBeNull();
  });
});
