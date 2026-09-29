import * as Haptics from "expo-haptics";
import { FolderPen, Pencil, X } from "lucide-react-native";
import { useState } from "react";
import { Alert } from "react-native";
import type { AgentInfo } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";
import { PromptSheet } from "../ui/PromptSheet";
import { colors } from "../ui/theme";
import { agentName, agentTitle, projectOf } from "./agents";

type Renaming = { kind: "agent" | "workspace"; initial: string } | null;

/**
 * Rename or close an agent (or plain terminal pane), and rename its herdr
 * workspace. Render it once and call `show(target)`, e.g. on long-press.
 */
export function useAgentActions(
  client: HostConnection | null,
  opts: { onClosed?: (paneId: string) => void; /** Shown before Close, e.g. screen settings. */ extra?: SheetAction[] } = {},
) {
  const [target, setTarget] = useState<{ paneId: string; workspaceId: string; agent: AgentInfo | null } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [renaming, setRenaming] = useState<Renaming>(null);

  const show = (paneId: string, workspaceId: string, agent: AgentInfo | null) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setTarget({ paneId, workspaceId, agent });
    setSheet(true);
  };

  const fail = (what: string) => (err: Error) => Alert.alert(`Couldn't ${what}`, err.message);

  const renameWorkspace = async () => {
    if (!client || !target) return;
    let label = "";
    try {
      const { workspaces } = await client.call<{ workspaces: { workspace_id: string; label: string }[] }>("workspace.list");
      label = workspaces.find((w) => w.workspace_id === target.workspaceId)?.label ?? "";
    } catch {
      // start empty
    }
    setRenaming({ kind: "workspace", initial: label });
  };

  const close = () => {
    if (!client || !target) return;
    const what = target.agent ? agentName(target.agent) : "this terminal";
    Alert.alert(`Close ${what}?`, "This ends the process in that pane on your computer, like closing it in herdr.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Close",
        style: "destructive",
        onPress: () =>
          client.call("pane.close", { pane_id: target.paneId }).then(() => opts.onClosed?.(target.paneId), fail("close it")),
      },
    ]);
  };

  const submitRename = (value: string) => {
    if (!client || !target || !renaming) return;
    if (renaming.kind === "agent") {
      const call = target.agent
        ? client.call("agent.rename", { target: target.paneId, name: value })
        : client.call("pane.rename", { pane_id: target.paneId, label: value });
      void call.catch(fail("rename it"));
    } else {
      void client.call("workspace.rename", { workspace_id: target.workspaceId, label: value }).catch(fail("rename the workspace"));
    }
  };

  const agent = target?.agent ?? null;
  const element = (
    <>
      <ActionSheet
        visible={sheet}
        title={agent ? `${agentTitle(agent) ?? agentName(agent)} · ${projectOf(agent)}` : "Terminal"}
        onClose={() => setSheet(false)}
        actions={[
          {
            icon: <Pencil size={19} color={colors.text} />,
            title: agent ? "Rename agent" : "Rename pane",
            onPress: () => setRenaming({ kind: "agent", initial: agent?.name ?? "" }),
          },
          {
            icon: <FolderPen size={19} color={colors.text} />,
            title: "Rename workspace",
            detail: "Its name in herdr's sidebar",
            onPress: () => void renameWorkspace(),
          },
          ...(opts.extra ?? []),
          {
            icon: <X size={19} color={colors.danger} />,
            title: agent ? "Close agent" : "Close terminal",
            detail: "Ends it on your computer",
            onPress: close,
          },
        ]}
      />
      <PromptSheet
        visible={renaming !== null}
        title={renaming?.kind === "workspace" ? "Rename workspace" : agent ? "Rename agent" : "Rename pane"}
        initial={renaming?.initial ?? ""}
        placeholder={renaming?.kind === "workspace" ? "Workspace name" : "Name"}
        onSubmit={submitRename}
        onClose={() => setRenaming(null)}
      />
    </>
  );
  return { show, element };
}
