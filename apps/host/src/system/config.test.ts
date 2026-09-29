import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfigPath, envVar } from "./config.ts";

describe("config location", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const base = () => {
    const dir = mkdtempSync(join(tmpdir(), "shepherd-config-"));
    dirs.push(dir);
    return dir;
  };

  it("uses ~/.config/shepherd", () => {
    const home = base();
    expect(defaultConfigPath({ XDG_CONFIG_HOME: home })).toBe(join(home, "shepherd", "host.json"));
  });

  it("moves the folder from before the rename, keeping its contents", () => {
    const home = base();
    mkdirSync(join(home, "sheperd"));
    writeFileSync(join(home, "sheperd", "host.json"), '{"hostKey":"k"}');
    expect(defaultConfigPath({ XDG_CONFIG_HOME: home })).toBe(join(home, "shepherd", "host.json"));
    expect(readFileSync(join(home, "shepherd", "host.json"), "utf8")).toBe('{"hostKey":"k"}');
    expect(existsSync(join(home, "sheperd"))).toBe(false);
  });

  it("reads the new environment variables, then the old ones", () => {
    expect(envVar({ SHEPHERD_PORT: "1", SHEPERD_PORT: "2" }, "PORT")).toBe("1");
    expect(envVar({ SHEPERD_PORT: "2" }, "PORT")).toBe("2");
    expect(defaultConfigPath({ SHEPERD_CONFIG: "/x/host.json" })).toBe("/x/host.json");
  });
});
