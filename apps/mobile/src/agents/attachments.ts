import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import type { UploadResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import type { Attachment } from "./attachment-message";

const CHUNK = 256 * 1024;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic" };

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function upload(client: HostConnection, base64: string, mime: string): Promise<string> {
  const uploadId = newId();
  for (let from = 0; ; from += CHUNK) {
    const done = from + CHUNK >= base64.length;
    const result = await client.call<UploadResult>("shepherd.upload", { uploadId, mime, data: base64.slice(from, from + CHUNK), done });
    if (done) {
      if (!("path" in result)) throw new Error("The image didn't arrive.");
      return result.path;
    }
  }
}

/** Images picked on the phone and sent to the host, ready to go with the next message. */
export function useAttachments(client: HostConnection | null) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const update = (id: string, patch: Partial<Attachment>) => setAttachments((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const add = useCallback(async () => {
    if (!client) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.85, allowsMultipleSelection: true, selectionLimit: 4 });
    if (picked.canceled) return;
    for (const asset of picked.assets) {
      const id = newId();
      setAttachments((list) => [...list, { id, uri: asset.uri, state: "uploading" }]);
      const ext = /\.(\w+)(?:\?|$)/.exec(asset.fileName ?? asset.uri)?.[1]?.toLowerCase() ?? "";
      const mime = asset.mimeType ?? TYPES[ext] ?? "image/jpeg";
      if (!asset.base64) {
        update(id, { state: "failed", error: "Couldn't read that image." });
        continue;
      }
      upload(client, asset.base64, mime).then(
        (path) => update(id, { state: "ready", path }),
        (err: Error) => update(id, { state: "failed", error: err.message }),
      );
    }
  }, [client]);

  const remove = useCallback((id: string) => setAttachments((list) => list.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => setAttachments([]), []);
  const uploading = attachments.some((a) => a.state === "uploading");
  const ready = attachments.some((a) => a.state === "ready");
  return { attachments, add, remove, clear, uploading, ready };
}
