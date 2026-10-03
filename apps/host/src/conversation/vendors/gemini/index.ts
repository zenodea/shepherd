import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentInfo, SubagentStatus } from "@shepherd/protocol";
import { cwdsOf, firstRecord, jsonlFiles, modifiedAt } from "../../files.ts";
import { TranscriptReader } from "../../reader.ts";
import { str } from "../../entries.ts";
import type { SubagentSource, Vendor } from "../../vendor.ts";
import { geminiParser } from "./parser.ts";

/** A subagent's file still being written to this recently counts as running. */
const RUNNING_MS = 60_000;

/** Gemini CLI's folder for a project: named in projects.json, or found by the .project_root file in it. */
function projectDir(home: string, cwd: string): string | null {
  const tmp = join(home, "tmp");
  try {
    const projects = JSON.parse(readFileSync(join(home, "projects.json"), "utf8")) as { projects?: Record<string, string> };
    const slug = projects.projects?.[resolve(cwd)];
    if (slug) return join(tmp, slug);
  } catch {
    // no registry yet
  }
  let names: string[];
  try {
    names = readdirSync(tmp);
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      if (readFileSync(join(tmp, name, ".project_root"), "utf8").trim() === resolve(cwd)) return join(tmp, name);
    } catch {
      // not a project folder
    }
  }
  return null;
}

function subagents(transcript: string): SubagentSource[] {
  const session = str(firstRecord(transcript)?.sessionId);
  if (!session) return [];
  const dir = join(transcript, "..", session);
  return jsonlFiles(dir).map(({ path, mtimeMs }): SubagentSource => {
    const id = path.replace(/^.*\//, "").replace(/\.jsonl$/, "");
    const meta = firstRecord(path);
    return {
      id,
      name: id,
      kind: str(meta?.agentName) ?? null,
      depth: 1,
      startedAt: str(meta?.startTime) ?? null,
      transcript: path,
      open: () => new TranscriptReader(path, geminiParser),
      status: (): SubagentStatus => (Date.now() - (modifiedAt(path) ?? mtimeMs) < RUNNING_MS ? "running" : "done"),
      startedBy: () => false,
    };
  });
}

export function gemini({ home }: { home: string }): Vendor {
  const locate = (agent: AgentInfo): string | null => {
    for (const cwd of cwdsOf(agent)) {
      const dir = projectDir(home, cwd);
      // Newest by when it was last written: resuming a session keeps appending to its old file.
      const newest = dir ? jsonlFiles(join(dir, "chats")).find((f) => /\/session-[^/]+\.jsonl$/.test(f.path)) : undefined;
      if (newest) return newest.path;
    }
    return null;
  };
  return { id: "gemini", locate, open: (transcript) => new TranscriptReader(transcript, geminiParser), subagents };
}
