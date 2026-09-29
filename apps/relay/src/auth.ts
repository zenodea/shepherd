const encoder = new TextEncoder();

/** Bearer header, or `?token=` for clients (WebViews) that can't set headers. */
export function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return new URL(request.url).searchParams.get("token");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two secrets (hashed first so lengths match). */
export async function secretsEqual(presented: string | null, expected: string): Promise<boolean> {
  if (!presented) return false;
  return hashesEqual(await sha256Hex(presented), await sha256Hex(expected));
}

export function hashesEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
