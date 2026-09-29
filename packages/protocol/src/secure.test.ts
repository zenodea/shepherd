import { describe, expect, it } from "vitest";
import {
  CipherState,
  SecureChannelError,
  fromHex,
  generateKeyPair,
  initiateHandshake,
  openJson,
  relayCredential,
  respondHandshake,
  sealJson,
  toHex,
  utf8Decode,
  utf8Encode,
} from "./secure.ts";

function handshake() {
  const hostStatic = generateKeyPair();
  const hostEphemeral = generateKeyPair();
  const app = initiateHandshake(hostStatic.publicKey, hostEphemeral.publicKey);
  const host = respondHandshake(hostStatic, hostEphemeral, app.ephemeral);
  return { app: app.ciphers, host, hostStatic, hostEphemeral };
}

describe("secure channel", () => {
  it("both sides derive matching keys and exchange messages", () => {
    const { app, host } = handshake();
    const msg = { type: "auth", token: "d_secret", device: { name: "Pixel ✨" } };
    expect(JSON.parse(openJson(host.receive, sealJson(app.send, msg)))).toEqual(msg);
    expect(JSON.parse(openJson(app.receive, sealJson(host.send, { type: "hello" })))).toEqual({ type: "hello" });
  });

  it("keeps working across many messages in order", () => {
    const { app, host } = handshake();
    for (let i = 0; i < 50; i++) expect(openJson(host.receive, sealJson(app.send, i))).toBe(String(i));
  });

  it("does not leak plaintext", () => {
    const { app } = handshake();
    const frame = sealJson(app.send, { token: "d_very_secret_token" });
    expect(utf8Decode(frame)).not.toContain("very_secret");
  });

  it("rejects tampered, replayed and reordered frames", () => {
    const tampered = handshake();
    const frame = sealJson(tampered.app.send, { a: 1 });
    frame[0] = frame[0]! ^ 1;
    expect(() => openJson(tampered.host.receive, frame)).toThrow(SecureChannelError);

    const replay = handshake();
    const once = sealJson(replay.app.send, { a: 1 });
    openJson(replay.host.receive, once);
    expect(() => openJson(replay.host.receive, once)).toThrow(SecureChannelError);

    const reorder = handshake();
    const first = sealJson(reorder.app.send, 1);
    const second = sealJson(reorder.app.send, 2);
    expect(() => openJson(reorder.host.receive, second)).toThrow(SecureChannelError);
    void first;
  });

  it("an impostor without the host's static key derives different keys", () => {
    const real = generateKeyPair();
    const impostor = generateKeyPair();
    const ephemeral = generateKeyPair();
    // The app pinned `real` but is talking to someone holding only `impostor`.
    const app = initiateHandshake(real.publicKey, ephemeral.publicKey);
    const fake = respondHandshake({ ...impostor, publicKey: real.publicKey }, ephemeral, app.ephemeral);
    expect(() => openJson(fake.receive, sealJson(app.ciphers.send, { token: "d_x" }))).toThrow(SecureChannelError);
  });

  it("gives each connection fresh keys", () => {
    const hostStatic = generateKeyPair();
    const e1 = generateKeyPair();
    const e2 = generateKeyPair();
    const a = initiateHandshake(hostStatic.publicKey, e1.publicKey);
    const b = initiateHandshake(hostStatic.publicKey, e2.publicKey);
    expect(toHex(sealJson(a.ciphers.send, "same"))).not.toBe(toHex(sealJson(b.ciphers.send, "same")));
  });

  it("rejects malformed and low-order keys", () => {
    expect(() => fromHex("zz")).toThrow(SecureChannelError);
    expect(() => initiateHandshake(new Uint8Array(32), generateKeyPair().publicKey)).toThrow(SecureChannelError);
  });

  it("uses a counter nonce per direction", () => {
    const key = new Uint8Array(32).fill(7);
    const a = new CipherState(key);
    const b = new CipherState(key);
    expect(b.decrypt(a.encrypt(utf8Encode("x")))).toEqual(utf8Encode("x"));
  });
});

describe("utf8", () => {
  it("round-trips ASCII, accents, CJK and emoji", () => {
    const text = "plain · café · 日本語 · 🐑🧑‍💻";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(utf8Encode(text)).toEqual(new TextEncoder().encode(text));
  });
});

describe("relayCredential", () => {
  it("is a stable hash that doesn't reveal the token", () => {
    expect(relayCredential("d_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(relayCredential("d_abc")).toBe(relayCredential("d_abc"));
    expect(relayCredential("d_abc")).not.toContain("abc");
  });
});
