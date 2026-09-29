// @noble crypto (end-to-end encryption) needs crypto.getRandomValues, which
// React Native doesn't provide by itself. Import this before connecting.
import { getRandomValues } from "expo-crypto";

const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== "function") {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues };
}
