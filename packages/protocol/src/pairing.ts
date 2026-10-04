// Pairing link the host shows as a QR code and the app scans (or opens as a
// deep link): shepherd://pair?v=1&n=<name>&t=<token>&u=<url>&u=<url>…
//
// Parsed by hand rather than with URL/URLSearchParams, whose React Native
// implementations are incomplete.

export const PAIRING_VERSION = 1;
export const DEFAULT_HOST_PORT = 7420;

export type PairingInfo = {
  name: string;
  token: string;
  /** Every address the host might be reachable on; the app tries them all. */
  urls: string[];
  /** Host's static public key (hex), pinned for end-to-end encryption. */
  hostKey?: string;
};

/** Like encodeURIComponent, but keeps `:` and `/` readable to shrink the QR code. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
}

export function encodePairingLink(info: PairingInfo, scheme = "shepherd"): string {
  const params = [
    `v=${PAIRING_VERSION}`,
    `n=${encode(info.name)}`,
    `t=${encode(info.token)}`,
    ...(info.hostKey ? [`k=${info.hostKey}`] : []),
    ...info.urls.map((u) => `u=${encode(u)}`),
  ];
  return `${scheme}://pair?${params.join("&")}`;
}

/**
 * Accepts `shepherd://pair?…` and Expo Go's `exp://host:8081/--/pair?…`.
 * Returns null for anything that isn't a valid pairing link.
 */
export function parsePairingLink(text: string): PairingInfo | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^?#]*\/)?pair\?([^#]*)/i.exec(text.trim());
  if (!match) return null;

  let version: string | undefined;
  let name = "";
  let token = "";
  let hostKey: string | undefined;
  const urls: string[] = [];
  for (const pair of match[1]!.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    } catch {
      return null;
    }
    switch (pair.slice(0, eq)) {
      case "v":
        version = value;
        break;
      case "n":
        name = value;
        break;
      case "t":
        token = value;
        break;
      case "k":
        if (!/^[0-9a-f]{64}$/.test(value)) return null;
        hostKey = value;
        break;
      case "u":
        try {
          urls.push(normaliseHostUrl(value));
        } catch {
          // skip addresses this app can't use
        }
        break;
    }
  }
  if (version !== String(PAIRING_VERSION) || !token || urls.length === 0) return null;
  return { name: name || "host", token, urls: [...new Set(urls)], ...(hostKey ? { hostKey } : {}) };
}

/**
 * Normalise what a person types into a WebSocket URL:
 * `192.168.1.5` → `ws://192.168.1.5:7420/connect`, `https://relay/…` → `wss://relay/…`.
 */
export function normaliseHostUrl(input: string): string {
  const trimmed = input.trim();
  const match = /^(?:([a-z]+):\/\/)?([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(trimmed);
  if (!match) throw new Error("Enter an address like 192.168.1.20 or ws://host:7420/connect");
  const [, rawScheme = "ws", authority, rawPath = ""] = match;
  const scheme = { ws: "ws", wss: "wss", http: "ws", https: "wss" }[rawScheme.toLowerCase()];
  if (!scheme) throw new Error("Use a ws://, wss://, http:// or https:// address");

  const hasPort = /:\d+$/.test(authority!) && !/^\[[^\]]*\]$/.test(authority!);
  const host = scheme === "ws" && !hasPort ? `${authority}:${DEFAULT_HOST_PORT}` : authority!;
  const path = rawPath === "" || rawPath === "/" ? "/connect" : rawPath;
  return `${scheme}://${host}${path}`;
}

/**
 * Hex characters of the host key carried in a typed pairing code, so the app can
 * tell the computer that made the code from anything else answering first.
 * 64 bits: too many to grind a matching key within a code's lifetime.
 */
export const MANUAL_CODE_KEY_CHARS = 16;

/** The code people type when they can't scan: `<pairing code>.<start of the host key>`. */
export function formatManualCode(code: string, hostKey: string): string {
  return `${code}.${hostKey.slice(0, MANUAL_CODE_KEY_CHARS)}`;
}

/** Splits a typed code into its token and host-key prefix; null when the check part is missing. */
export function parseManualCode(text: string): { token: string; hostKeyPrefix: string } | null {
  const match = new RegExp(`^(\\S+)\\.([0-9a-f]{${MANUAL_CODE_KEY_CHARS}})$`, "i").exec(text.trim());
  if (!match) return null;
  return { token: match[1]!, hostKeyPrefix: match[2]!.toLowerCase() };
}
