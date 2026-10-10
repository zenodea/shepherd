import { useHostState } from "../connection/connection";
import { Banner } from "./Screen";

/** Why the computer isn't connected, if it isn't; `pairHint` follows the error when the phone isn't paired. */
export function ConnectionBanner({ pairHint }: { pairHint?: string }) {
  const state = useHostState();
  if (state.status === "online") return null;
  if (state.status === "unauthorized") return <Banner tone="danger">{[state.error ?? "Not paired.", pairHint].filter(Boolean).join(" ")}</Banner>;
  if (!state.network) return <Banner tone="danger">{state.agents.length ? "No network · showing what you last saw" : "No network · can't reach your computer"}</Banner>;
  if (state.status === "connecting") return <Banner>Connecting…</Banner>;
  // Offline, the agents and chats on screen are the phone's copy from last time: say so plainly.
  return <Banner tone="danger">{state.agents.length ? "Offline · showing what you last saw. Retrying…" : "Offline · can't reach your computer. Retrying…"}</Banner>;
}
