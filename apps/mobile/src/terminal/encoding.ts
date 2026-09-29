import { utf8Encode } from "@sheperd/protocol";

/** Text → base64 of its UTF-8 bytes (what the terminal page decodes). */
export function textToBase64(text: string): string {
  const bytes = utf8Encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
