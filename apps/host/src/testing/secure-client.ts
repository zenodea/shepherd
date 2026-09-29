import type { WebSocket } from "ws";
import {
  fromHex,
  initiateHandshake,
  openJson,
  parseHostHello,
  sealJson,
  type ServerMessage,
  type SessionCiphers,
} from "@shepherd/protocol";

export type SecureTestClient = {
  messages: ServerMessage[];
  /** Encrypt and send (after the handshake). */
  send: (msg: unknown) => void;
  closeCode: () => number | null;
  hostKey: () => string | null;
};

/**
 * The app's side of the encrypted channel, for tests: answers `ready` with a
 * handshake, then authenticates with `token` (unless null).
 */
export function secureClient(ws: WebSocket, token: string | null, deviceName = "Test phone"): SecureTestClient {
  const messages: ServerMessage[] = [];
  let ciphers: SessionCiphers | null = null;
  let code: number | null = null;
  let hostKey: string | null = null;

  const send = (msg: unknown) => {
    if (ciphers) ws.send(sealJson(ciphers.send, msg), { binary: true });
  };

  ws.on("message", (data, isBinary) => {
    if (!ciphers) {
      const ready = isBinary ? null : parseHostHello(data.toString());
      if (!ready) throw new Error(`expected ready, got ${data.toString()}`);
      hostKey = ready.e2e.hostKey;
      const handshake = initiateHandshake(fromHex(ready.e2e.hostKey), fromHex(ready.e2e.ephemeral));
      ciphers = handshake.ciphers;
      ws.send(JSON.stringify({ type: "handshake", ephemeral: Buffer.from(handshake.ephemeral).toString("hex") }));
      if (token !== null) send({ type: "auth", token, device: { name: deviceName } });
      return;
    }
    messages.push(JSON.parse(openJson(ciphers.receive, new Uint8Array(data as Buffer))) as ServerMessage);
  });
  ws.on("close", (c) => (code = c));

  return { messages, send, closeCode: () => code, hostKey: () => hostKey };
}
