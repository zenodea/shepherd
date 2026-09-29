// Messages on the host's always-open control socket to the relay. App traffic
// never travels here: the relay asks the host to "dial" a fresh data socket per
// app connection and splices the two together without parsing them.

export const relayPaths = {
  /** Host → relay, long-lived control socket. */
  control: (hostId: string) => `/hosts/${encodeURIComponent(hostId)}/control`,
  /** Host → relay, one data socket per app connection. */
  dial: (hostId: string, ticket: string) =>
    `/hosts/${encodeURIComponent(hostId)}/dial?ticket=${encodeURIComponent(ticket)}`,
  /** App → relay. */
  connect: (hostId: string) => `/hosts/${encodeURIComponent(hostId)}/connect`,
};

export const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Heartbeat on the control socket. The relay answers with an auto-response,
 * so these exact strings must not change (the Durable Object stays asleep).
 */
export const TUNNEL_PING = '{"type":"ping"}';
export const TUNNEL_PONG = '{"type":"pong"}';

export type RelayToHost = { type: "dial"; ticket: string } | { type: "registered" };

export type HostToRelay =
  /**
   * Sent right after the control socket opens. The relay admits app
   * connections whose token hashes to `clientTokenHash` (hex SHA-256), so it
   * never learns the token itself.
   */
  { type: "register"; clientTokenHash: string };

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const msg: unknown = JSON.parse(raw);
    return typeof msg === "object" && msg !== null && !Array.isArray(msg) ? (msg as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseRelayToHost(raw: string): RelayToHost | null {
  const m = parseObject(raw);
  if (m?.type === "dial" && typeof m.ticket === "string" && m.ticket.length > 0) return { type: "dial", ticket: m.ticket };
  if (m?.type === "registered") return { type: "registered" };
  return null;
}

export function parseHostToRelay(raw: string): HostToRelay | null {
  const m = parseObject(raw);
  if (m?.type === "register" && typeof m.clientTokenHash === "string" && /^[0-9a-f]{64}$/.test(m.clientTokenHash)) {
    return { type: "register", clientTokenHash: m.clientTokenHash };
  }
  return null;
}
