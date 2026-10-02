import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPidFile, pidFilePath, readRunningHost, writePidFile } from "./daemon.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempConfig = () => {
  const d = mkdtempSync(join(tmpdir(), "shepherd-daemon-"));
  dirs.push(d);
  return join(d, "host.json");
};

describe("pid file", () => {
  it("reports this process as the running host until it clears the file", () => {
    const config = tempConfig();
    expect(readRunningHost(config)).toBeNull();
    writePidFile(config, "/tmp/herdr.sock");
    expect(readRunningHost(config)).toMatchObject({ pid: process.pid, socketPath: "/tmp/herdr.sock" });
    clearPidFile(config);
    expect(readRunningHost(config)).toBeNull();
  });

  it("ignores a stale pid and leaves another host's file alone", () => {
    const config = tempConfig();
    // Larger than any real pid.
    writeFileSync(pidFilePath(config), JSON.stringify({ pid: 2 ** 30, socketPath: "/x", startedAt: "" }));
    expect(readRunningHost(config)).toBeNull();
    clearPidFile(config);
    expect(readRunningHost(config)).toBeNull();

    writeFileSync(pidFilePath(config), JSON.stringify({ pid: process.ppid, socketPath: "/x", startedAt: "" }));
    clearPidFile(config);
    expect(readRunningHost(config)?.pid).toBe(process.ppid);
  });

  it("treats a garbled file as no host", () => {
    const config = tempConfig();
    writeFileSync(pidFilePath(config), "not json");
    expect(readRunningHost(config)).toBeNull();
  });
});
