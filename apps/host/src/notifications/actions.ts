import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BlockedPrompt } from "@shepherd/protocol";

/** ntfy action button (https://docs.ntfy.sh/publish/#action-buttons). */
export type NtfyAction = { action: "http"; label: string; url: string; method: "POST"; body: string; clear: boolean };

/** ntfy allows three buttons per notification. */
const MAX_BUTTONS = 3;
const MAX_LABEL = 24;
/** A button stops working after this long; the prompt has likely moved on anyway. */
export const ACTION_TTL_MS = 30 * 60_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export type ActionPayload = {
  /** pane */
  p: string;
  /** herdr key that picks the option */
  k: string;
  /** fingerprint of the prompt the button was made for */
  h: string;
  /** expiry, unix ms */
  e: number;
  /** nonce: each button works once */
  n: string;
};

export type ActionOutcome =
  | { ok: true; paneId: string; label: string }
  | { ok: false; paneId: string | null; reason: "invalid" | "expired" | "used" | "not_blocked" | "changed" | "failed" };

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; body: AsyncIterable<Uint8Array> | null }>;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/** Identifies a question and its answers, so a button can't answer a different one. */
export function promptFingerprint(prompt: BlockedPrompt): string {
  const question = { lines: prompt.lines, options: prompt.options.map((o) => [o.key, o.label]) };
  return createHash("sha256").update(JSON.stringify(question)).digest("base64url").slice(0, 16);
}

export type NotificationActionsOptions = {
  /** ntfy server, e.g. https://ntfy.sh */
  server: string;
  /** The notification topic; the reply topic is derived from it and the key. */
  topic: string;
  /** Secret key material (the host's identity key); only a key derived from it is used. */
  secret: Uint8Array;
  /** What the agent is asking right now, or null. */
  readPrompt: (paneId: string) => Promise<BlockedPrompt | null>;
  isBlocked: (paneId: string) => boolean;
  sendKey: (paneId: string, key: string) => Promise<void>;
  /** Told about every button press, e.g. to notify when one couldn't be applied. */
  onOutcome?: (outcome: ActionOutcome) => void;
  onError?: (err: Error) => void;
  fetch?: Fetch;
  now?: () => number;
};

/**
 * Answer buttons on "needs input" notifications. Each button posts a signed,
 * single-use token to a reply topic on the same ntfy server, which the host
 * listens to. The host only acts if the signature checks out, the token hasn't
 * expired or been used, and the agent is still asking the very same question;
 * then it presses that option's key. Tokens can only pick an option the agent
 * offered, never type anything else.
 */
export class NotificationActions {
  readonly replyTopic: string;
  private readonly key: Buffer;
  private readonly opts: NotificationActionsOptions;
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private readonly used = new Map<string, number>();
  private abort: AbortController | null = null;
  private lastId: string | null = null;

  constructor(opts: NotificationActionsOptions) {
    this.opts = opts;
    this.key = createHmac("sha256", Buffer.from(opts.secret)).update("shepherd notification actions v1").digest();
    this.replyTopic = `shepherd-r-${b64(createHmac("sha256", this.key).update(`reply:${opts.topic}`).digest()).slice(0, 22)}`;
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.now = opts.now ?? Date.now;
  }

  private get base(): string {
    return this.opts.server.replace(/\/+$/, "");
  }

  sign(payload: ActionPayload): string {
    const body = b64(JSON.stringify(payload));
    return `${body}.${b64(createHmac("sha256", this.key).update(body).digest().subarray(0, 16))}`;
  }

  verify(token: string): ActionPayload | null {
    const [body, mac] = token.trim().split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.key).update(body).digest().subarray(0, 16);
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActionPayload;
      return typeof payload.p === "string" && typeof payload.k === "string" && typeof payload.n === "string" ? payload : null;
    } catch {
      return null;
    }
  }

  /** Buttons for a prompt's first options (ntfy shows at most three). */
  buttons(paneId: string, prompt: BlockedPrompt): NtfyAction[] {
    const h = promptFingerprint(prompt);
    const e = this.now() + ACTION_TTL_MS;
    return prompt.options.slice(0, MAX_BUTTONS).map((option) => ({
      action: "http",
      label: option.label.length > MAX_LABEL ? `${option.label.slice(0, MAX_LABEL - 1)}…` : option.label,
      url: `${this.base}/${this.replyTopic}`,
      method: "POST",
      body: this.sign({ p: paneId, k: option.key, h, e, n: randomBytes(8).toString("hex") }),
      clear: true,
    }));
  }

  /** Apply one button press. */
  async handle(token: string): Promise<ActionOutcome> {
    const outcome = await this.apply(token);
    this.opts.onOutcome?.(outcome);
    return outcome;
  }

  private async apply(token: string): Promise<ActionOutcome> {
    const payload = this.verify(token);
    if (!payload) return { ok: false, paneId: null, reason: "invalid" };
    const now = this.now();
    for (const [nonce, expiry] of this.used) if (expiry < now) this.used.delete(nonce);
    if (payload.e < now) return { ok: false, paneId: payload.p, reason: "expired" };
    if (this.used.has(payload.n)) return { ok: false, paneId: payload.p, reason: "used" };
    this.used.set(payload.n, payload.e);

    if (!this.opts.isBlocked(payload.p)) return { ok: false, paneId: payload.p, reason: "not_blocked" };
    const prompt = await this.opts.readPrompt(payload.p).catch(() => null);
    const option = prompt?.options.find((o) => o.key === payload.k);
    if (!prompt || !option || promptFingerprint(prompt) !== payload.h) return { ok: false, paneId: payload.p, reason: "changed" };
    try {
      await this.opts.sendKey(payload.p, payload.k);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      return { ok: false, paneId: payload.p, reason: "failed" };
    }
    return { ok: true, paneId: payload.p, label: option.label };
  }

  /** Listen for button presses until `stop()`. */
  start(): void {
    if (this.abort) return;
    this.abort = new AbortController();
    void this.listen(this.abort.signal);
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private async listen(signal: AbortSignal): Promise<void> {
    let retry = MIN_RETRY_MS;
    while (!signal.aborted) {
      try {
        const since = this.lastId ? `?since=${encodeURIComponent(this.lastId)}` : "";
        const res = await this.fetchImpl(`${this.base}/${this.replyTopic}/json${since}`, { signal });
        if (!res.ok || !res.body) throw new Error(`ntfy responded ${res.status}`);
        retry = MIN_RETRY_MS;
        const decoder = new TextDecoder();
        let buffered = "";
        for await (const chunk of res.body) {
          buffered += decoder.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = buffered.indexOf("\n")) !== -1) {
            const line = buffered.slice(0, nl).trim();
            buffered = buffered.slice(nl + 1);
            if (line) await this.onLine(line);
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, retry));
      retry = Math.min(retry * 2, MAX_RETRY_MS);
    }
  }

  private async onLine(line: string): Promise<void> {
    let event: { id?: string; event?: string; message?: string };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.event !== "message" || typeof event.message !== "string") return;
    if (event.id) this.lastId = event.id;
    await this.handle(event.message);
  }
}
