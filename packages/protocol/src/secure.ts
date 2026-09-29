// End-to-end encryption between the app and the host, so the relay (or anyone
// on the network) only ever sees ciphertext.
//
// Handshake (Noise "NK" shape: the app already knows the host's static key
// from the pairing QR code):
//
//   host → app  (plaintext)  ready { hostKey: s_h, ephemeral: e_h }
//   app  → host (plaintext)  handshake { ephemeral: e_c }
//   both: ikm = X25519(e_c, e_h) ‖ X25519(e_c, s_h)
//         keys = HKDF-SHA256(ikm, salt = SHA-256(label ‖ s_h ‖ e_h ‖ e_c), info = "keys", 64)
//
// `ee` gives forward secrecy; `es` means only the holder of s_h can derive the
// keys, so the app knows it reached the real host. The app then proves who it
// is by sending its device token inside the encrypted channel.
//
// Every later message is one binary WebSocket frame: ChaCha20-Poly1305 over the
// UTF-8 JSON, with a per-direction counter as the nonce (never sent), so
// dropped, replayed, reordered or altered frames fail to decrypt.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export const E2E_VERSION = 1;
const LABEL = "shepherd-e2e-v1";
const KEY_BYTES = 32;

export type KeyPair = { secretKey: Uint8Array; publicKey: Uint8Array };

export class SecureChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureChannelError";
  }
}

export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = x25519.keygen();
  return { secretKey, publicKey };
}

export function publicKeyFor(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

export const toHex = bytesToHex;

export function fromHex(hex: string, expectedBytes = KEY_BYTES): Uint8Array {
  if (typeof hex !== "string" || hex.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new SecureChannelError("malformed key");
  }
  return hexToBytes(hex.toLowerCase());
}

// UTF-8 by hand: Hermes (React Native) doesn't reliably provide TextDecoder.
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b >= 0xf0) {
      code = ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63);
      i += 4;
    } else if (b >= 0xe0) {
      code = ((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63);
      i += 3;
    } else {
      code = ((b & 31) << 6) | (bytes[i + 1]! & 63);
      i += 2;
    }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

/** One direction of the channel: AEAD with an implicit, strictly increasing counter nonce. */
export class CipherState {
  // A plain number is exact up to 2^53 messages; written as two 32-bit halves
  // because Hermes (React Native) may lack DataView.setBigUint64.
  private counter = 0;
  private readonly key: Uint8Array;

  constructor(key: Uint8Array) {
    this.key = key;
  }

  private nextNonce(): Uint8Array {
    if (this.counter >= Number.MAX_SAFE_INTEGER) throw new SecureChannelError("nonce space exhausted; reconnect");
    const nonce = new Uint8Array(12);
    const view = new DataView(nonce.buffer);
    view.setUint32(4, Math.floor(this.counter / 2 ** 32));
    view.setUint32(8, this.counter >>> 0);
    this.counter += 1;
    return nonce;
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    return chacha20poly1305(this.key, this.nextNonce()).encrypt(plaintext);
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    try {
      return chacha20poly1305(this.key, this.nextNonce()).decrypt(ciphertext);
    } catch {
      throw new SecureChannelError("message failed authentication (tampered, replayed or out of order)");
    }
  }
}

export type SessionCiphers = { send: CipherState; receive: CipherState };

function sessionKeys(ee: Uint8Array, es: Uint8Array, hostStatic: Uint8Array, hostEphemeral: Uint8Array, clientEphemeral: Uint8Array) {
  const ikm = new Uint8Array([...ee, ...es]);
  const salt = sha256(new Uint8Array([...utf8Encode(LABEL), ...hostStatic, ...hostEphemeral, ...clientEphemeral]));
  const okm = hkdf(sha256, ikm, salt, utf8Encode("keys"), 64);
  return { appToHost: okm.slice(0, 32), hostToApp: okm.slice(32, 64) };
}

/** App side: given the pinned host key and the host's ephemeral key from `ready`. */
export function initiateHandshake(hostStatic: Uint8Array, hostEphemeral: Uint8Array): { ephemeral: Uint8Array; ciphers: SessionCiphers } {
  const e = generateKeyPair();
  let ee: Uint8Array;
  let es: Uint8Array;
  try {
    ee = x25519.getSharedSecret(e.secretKey, hostEphemeral);
    es = x25519.getSharedSecret(e.secretKey, hostStatic);
  } catch {
    throw new SecureChannelError("invalid host key");
  }
  const keys = sessionKeys(ee, es, hostStatic, hostEphemeral, e.publicKey);
  return { ephemeral: e.publicKey, ciphers: { send: new CipherState(keys.appToHost), receive: new CipherState(keys.hostToApp) } };
}

/** Host side: its static and per-connection ephemeral key pairs, and the app's ephemeral key. */
export function respondHandshake(hostStatic: KeyPair, hostEphemeral: KeyPair, clientEphemeral: Uint8Array): SessionCiphers {
  let ee: Uint8Array;
  let es: Uint8Array;
  try {
    ee = x25519.getSharedSecret(hostEphemeral.secretKey, clientEphemeral);
    es = x25519.getSharedSecret(hostStatic.secretKey, clientEphemeral);
  } catch {
    throw new SecureChannelError("invalid app key");
  }
  const keys = sessionKeys(ee, es, hostStatic.publicKey, hostEphemeral.publicKey, clientEphemeral);
  return { send: new CipherState(keys.hostToApp), receive: new CipherState(keys.appToHost) };
}

/** Encrypt/decrypt JSON messages once the handshake is done. */
export function sealJson(cipher: CipherState, value: unknown): Uint8Array {
  return cipher.encrypt(utf8Encode(JSON.stringify(value)));
}

export function openJson(cipher: CipherState, frame: Uint8Array): string {
  return utf8Decode(cipher.decrypt(frame));
}

/**
 * What the app presents to the relay instead of its real token, so a relay
 * operator can't replay it to the host (which wants the token itself, inside
 * the encrypted channel). The host registers SHA-256 of this value.
 */
export function relayCredential(token: string): string {
  return bytesToHex(sha256(utf8Encode(token)));
}
