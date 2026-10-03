import { join } from "node:path";
import type { AgentInfo } from "@shepherd/protocol";
import { cwdsOf, firstRecord, jsonlFiles } from "../../files.ts";
import { TranscriptReader } from "../../reader.ts";
import type { Vendor } from "../../vendor.ts";
import { piParser, piSessionDir } from "./parser.ts";

export function pi({ home }: { home: string }): Vendor {
  const sessions = join(home, "sessions");
  const locate = (agent: AgentInfo): string | null => {
    for (const cwd of cwdsOf(agent)) {
      const main = jsonlFiles(join(sessions, piSessionDir(cwd))).find((f) => !firstRecord(f.path)?.parentSession);
      if (main) return main.path;
    }
    return null;
  };
  return { id: "pi", locate, open: (transcript) => new TranscriptReader(transcript, piParser) };
}
