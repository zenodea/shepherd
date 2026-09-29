import { useRouter } from "expo-router";
import { useCallback } from "react";
import type { PairingInfo } from "@sheperd/protocol";
import { useConnection } from "./connection";

/** Save a scanned/opened pairing and go to the agent list. */
export function usePairing(): (info: PairingInfo) => Promise<void> {
  const { connect } = useConnection();
  const router = useRouter();
  return useCallback(
    async (info: PairingInfo) => {
      await connect({ name: info.name, urls: info.urls, token: info.token });
      router.dismissTo("/");
    },
    [connect, router],
  );
}
