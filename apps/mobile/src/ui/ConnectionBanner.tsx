import { useHostState } from "../connection/connection";
import { Banner } from "./Screen";

/** Why the computer isn't connected, if it isn't; `pairHint` follows the error when the phone isn't paired. */
export function ConnectionBanner({ pairHint }: { pairHint?: string }) {
  const state = useHostState();
  if (state.status === "online") return null;
  if (state.status === "unauthorized") return <Banner tone="danger">{[state.error ?? "Not paired.", pairHint].filter(Boolean).join(" ")}</Banner>;
  if (state.status === "connecting") return <Banner>Connecting…</Banner>;
  return <Banner>Can&apos;t reach your computer. Retrying…</Banner>;
}
