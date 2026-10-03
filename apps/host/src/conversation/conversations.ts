import { existsSync } from "node:fs";
import type {
  AgentInfo,
  ConversationEntry,
  ConversationParams,
  ConversationResult,
  ImageParams,
  ImageResult,
  ImagesResult,
  Subagent,
  SubagentsResult,
} from "@shepherd/protocol";
import { expandHome } from "./files.ts";
import type { FoundImage } from "./images.ts";
import type { ConversationReader } from "./reader.ts";
import { sessionName, vendorFor, type SubagentSource, type Vendor } from "./vendor.ts";
import { defaultVendors } from "./vendors/index.ts";

const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 500;
const LOCATE_EVERY_MS = 4000;
const SUBAGENTS_EVERY_MS = 2000;
const MAX_READERS = 32;
/** base64 characters per answer: well under the relay's 1 MB message limit. */
const IMAGE_CHUNK = 256 * 1024;

type Unavailable = { available: false; reason: string };
type Session = { vendor: Vendor; transcript: string };

const unavailable = (reason: string): Unavailable => ({ available: false, reason });

export class Conversations {
  private readonly vendors: readonly Vendor[];
  private located = new Map<string, { at: number; path: string | null }>();
  private readers = new Map<string, ConversationReader>();
  private subagentLists = new Map<string, { at: number; sources: SubagentSource[]; described: Subagent[] | null }>();
  private imageCache = new Map<string, FoundImage>();

  constructor(vendors: readonly Vendor[] = defaultVendors()) {
    this.vendors = vendors;
  }

  get(agent: AgentInfo | null, params: ConversationParams): ConversationResult {
    const session = this.session(agent);
    if ("reason" in session) return session;
    const { vendor, transcript } = session;
    const sources = this.subagentSources(session);
    const source = params.subagent ? sources.find((s) => s.id === params.subagent) : undefined;
    if (params.subagent && !source) return unavailable("That subagent isn't in this conversation.");

    const reader = source ? this.reader(source.transcript, source.open) : this.reader(transcript, () => vendor.open(transcript));
    if (!reader) return unavailable("Couldn't read this agent's conversation.");
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const page = reader.page({ after: params.after, before: params.before, limit });
    const busy = agent?.agent_status === "working" || agent?.agent_status === "blocked";
    const queued = !source && vendor.queued ? (busy ? vendor.queued(transcript, reader) : []) : undefined;
    const context = reader.context();
    return {
      available: true,
      agent: vendor.id,
      session: sessionName(transcript) + (source ? `/${source.id}` : ""),
      ...page,
      entries: page.entries.map((entry) => linkSubagent(entry, sources)),
      ...(queued ? { queued } : {}),
      ...(context ? { context } : {}),
      ...(vendor.subagents ? { subagents: this.described(session) } : {}),
    };
  }

  subagents(agent: AgentInfo | null): SubagentsResult {
    const session = this.session(agent);
    if ("reason" in session) return session;
    if (!session.vendor.subagents) return unavailable(`${session.vendor.id} doesn't record subagents.`);
    return { available: true, subagents: this.described(session) };
  }

  images(agent: AgentInfo | null): ImagesResult {
    const session = this.session(agent);
    if ("reason" in session) return session;
    const reader = this.reader(session.transcript, () => session.vendor.open(session.transcript));
    if (!reader) return unavailable("Couldn't read this agent's conversation.");
    return { available: true, session: sessionName(session.transcript), groups: reader.imageGroups() };
  }

  /** One image from a transcript, in chunks of base64. */
  image(agent: AgentInfo | null, params: ImageParams): ImageResult {
    const session = this.session(agent);
    if ("reason" in session) return session;
    const source = params.subagent ? this.subagentSources(session).find((s) => s.id === params.subagent) : undefined;
    if (params.subagent && !source) return unavailable("That subagent isn't in this conversation.");
    const transcript = source?.transcript ?? session.transcript;
    const key = `${transcript}@${params.id}`;
    let image = this.imageCache.get(key);
    if (!image) {
      const reader = source ? this.reader(source.transcript, source.open) : this.reader(transcript, () => session.vendor.open(transcript));
      image = reader?.image(params.id) ?? undefined;
      if (!image) return unavailable("That image isn't in the conversation any more.");
      this.imageCache.set(key, image);
      if (this.imageCache.size > 4) this.imageCache.delete(this.imageCache.keys().next().value!);
    }
    const from = params.from ?? 0;
    return { available: true, mime: image.mime, total: image.data.length, from, data: image.data.slice(from, from + IMAGE_CHUNK) };
  }

  private session(agent: AgentInfo | null): Session | Unavailable {
    if (!agent) return unavailable("This tab isn't an agent.");
    const vendor = vendorFor(this.vendors, agent);
    if (!vendor) return unavailable(`Conversations aren't available for ${agent.agent ?? "this agent"} yet.`);
    const transcript = this.locate(agent, vendor);
    return transcript ? { vendor, transcript } : unavailable("No conversation found for this agent yet.");
  }

  private locate(agent: AgentInfo, vendor: Vendor): string | null {
    const key = `${agent.pane_id} ${vendor.id}`;
    const cached = this.located.get(key);
    if (cached && Date.now() - cached.at < LOCATE_EVERY_MS) return cached.path;
    const reported = agent.agent_session?.kind === "path" ? expandHome(agent.agent_session.value) : null;
    const path = reported && existsSync(reported) ? reported : vendor.locate(agent);
    this.located.set(key, { at: Date.now(), path });
    return path;
  }

  private reader(transcript: string, open: () => ConversationReader): ConversationReader | null {
    let reader = this.readers.get(transcript);
    if (reader) this.readers.delete(transcript);
    else reader = open();
    this.readers.set(transcript, reader);
    if (this.readers.size > MAX_READERS) this.readers.delete(this.readers.keys().next().value!);
    try {
      reader.refresh();
      return reader;
    } catch {
      this.readers.delete(transcript);
      this.located.clear();
      return null;
    }
  }

  private subagentSources({ vendor, transcript }: Session): SubagentSource[] {
    if (!vendor.subagents) return [];
    const cached = this.subagentLists.get(transcript);
    if (cached && Date.now() - cached.at < SUBAGENTS_EVERY_MS) return cached.sources;
    const sources = vendor.subagents(transcript).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    this.subagentLists.set(transcript, { at: Date.now(), sources, described: null });
    return sources;
  }

  private described(session: Session): Subagent[] {
    const sources = this.subagentSources(session);
    const list = this.subagentLists.get(session.transcript);
    if (!list) return [];
    list.described ??= sources.map((s) => this.describe(s));
    return list.described;
  }

  private describe(source: SubagentSource): Subagent {
    const progress = this.reader(source.transcript, source.open)?.progress();
    const latest = progress?.latest;
    const status = source.status();
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      depth: source.depth,
      status,
      startedAt: source.startedAt,
      updatedAt: latest?.at ?? source.startedAt,
      toolCalls: progress?.toolCalls ?? 0,
      doing: status === "running" && latest ? [latest.name, latest.summary].filter(Boolean).join(" ") : null,
    };
  }
}

function linkSubagent(entry: ConversationEntry, sources: SubagentSource[]): ConversationEntry {
  if (entry.kind !== "tool") return entry;
  const started = sources.find((s) => s.startedBy(entry));
  return started ? { ...entry, subagent: started.id } : entry;
}

const SUBAGENT_ID = /^[\w.-]{1,100}$/;
const IMAGE_ID = /^[\w.:-]{1,100}$/;

export function conversationParams(params: Record<string, unknown>, isPaneId: (v: unknown) => v is string): ConversationParams | null {
  const { paneId, subagent, after, before, limit } = params;
  if (!isPaneId(paneId)) return null;
  if (subagent !== undefined && !(typeof subagent === "string" && SUBAGENT_ID.test(subagent))) return null;
  const int = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= -1);
  if (!int(after) || !int(before) || !int(limit)) return null;
  return {
    paneId,
    ...(subagent !== undefined ? { subagent: subagent as string } : {}),
    ...(after !== undefined ? { after: after as number } : {}),
    ...(before !== undefined ? { before: before as number } : {}),
    ...(limit !== undefined ? { limit: limit as number } : {}),
  };
}

export function imageParams(params: Record<string, unknown>, isPaneId: (v: unknown) => v is string): ImageParams | null {
  const { paneId, subagent, id, from } = params;
  if (!isPaneId(paneId) || typeof id !== "string" || !IMAGE_ID.test(id)) return null;
  if (subagent !== undefined && !(typeof subagent === "string" && SUBAGENT_ID.test(subagent))) return null;
  if (from !== undefined && !(Number.isInteger(from) && (from as number) >= 0)) return null;
  return { paneId, id, ...(subagent !== undefined ? { subagent: subagent as string } : {}), ...(from !== undefined ? { from: from as number } : {}) };
}
