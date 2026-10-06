import { useEffect, useState } from "react";
import type { CommandsResult, SlashCommand } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

const FRESH_MS = 60_000;
const MAX_SHOWN = 5;
const lists = new Map<string, { at: number; commands: SlashCommand[] }>();
const NONE: SlashCommand[] = [];

/** The agent's "/" commands, asked for once you start typing one (and again after a minute). */
export function useSlashCommands(client: HostConnection | null, paneId: string | null, wanted: boolean): SlashCommand[] {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!client || !paneId || !wanted) return;
    const known = lists.get(paneId);
    if (known && Date.now() - known.at < FRESH_MS) return;
    let cancelled = false;
    client
      .call<CommandsResult>("shepherd.commands", { paneId })
      .then((result) => {
        lists.set(paneId, { at: Date.now(), commands: result.available ? result.commands : NONE });
        if (!cancelled) setLoaded((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, paneId, wanted]);
  return (paneId ? lists.get(paneId)?.commands : undefined) ?? NONE;
}

/** "/skill:grill-me" and "/prompts:explain" also answer to "/grill" and "/explain". */
const short = (name: string) => name.replace(/^\/(?:skill|prompts):/, "/");

/** Commands for what's typed so far ("/", "/co"): names that start with it first, then names that contain it. */
export function matchCommands(commands: SlashCommand[], typed: string): SlashCommand[] {
  const query = typed.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(query) || short(c.name).toLowerCase().startsWith(query));
  const contains = query.length > 1 ? commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(query.slice(1))) : [];
  return [...starts, ...contains].slice(0, MAX_SHOWN);
}

/** The command a message starts with, if it's one the agent has. */
export function commandIn(commands: SlashCommand[], text: string): SlashCommand | null {
  const first = text.trimStart().split(/\s/, 1)[0];
  return commands.find((c) => c.name === first) ?? null;
}
