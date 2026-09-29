import { useEffect, useState } from "react";
import type { AgentInfo, AgentStatus } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

export type WorkspaceTab = {
  tabId: string;
  /** The pane the phone shows for this tab: its agent, else its focused or first pane. */
  paneId: string;
  label: string;
  agent: AgentInfo | null;
  status: AgentStatus | null;
};

type SnapshotPane = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  focused?: boolean;
  label?: string | null;
  title?: string | null;
  terminal_title_stripped?: string | null;
  cwd?: string | null;
};
type SnapshotTab = { tab_id: string; workspace_id: string; number: number; label: string };
type Snapshot = { tabs: SnapshotTab[]; panes: SnapshotPane[]; workspaces: { workspace_id: string; label: string }[] };

const REFRESH_MS = 5000;

function paneLabel(pane: SnapshotPane, tab: SnapshotTab): string {
  const cwd = pane.cwd?.split("/").filter(Boolean).pop();
  // herdr numbers tabs "1", "2"… by default; a title says more.
  if (tab.label && !/^\d+$/.test(tab.label)) return tab.label;
  return pane.label || pane.terminal_title_stripped || pane.title || cwd || `Tab ${tab.number}`;
}

/** The herdr tabs in a workspace, like tmux windows, for switching between them. */
export function useWorkspaceTabs(client: HostConnection | null, workspaceId: string | null, agents: AgentInfo[]) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!client || !workspaceId) return;
    let cancelled = false;
    const load = () =>
      client
        .call<{ snapshot: Snapshot }>("session.snapshot")
        .then((r) => !cancelled && setSnapshot(r.snapshot))
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, workspaceId]);

  if (!snapshot || !workspaceId) return { tabs: [] as WorkspaceTab[], workspaceLabel: null as string | null, panes: [] as SnapshotPane[] };
  const tabs = snapshot.tabs
    .filter((t) => t.workspace_id === workspaceId)
    .sort((a, b) => a.number - b.number)
    .map((tab): WorkspaceTab | null => {
      const panes = snapshot.panes.filter((p) => p.tab_id === tab.tab_id);
      const agent = agents.find((a) => a.tab_id === tab.tab_id) ?? null;
      const pane = (agent && panes.find((p) => p.pane_id === agent.pane_id)) || panes.find((p) => p.focused) || panes[0];
      if (!pane) return null;
      return {
        tabId: tab.tab_id,
        paneId: pane.pane_id,
        label: agent ? agent.terminal_title_stripped || agent.title || agent.agent || paneLabel(pane, tab) : paneLabel(pane, tab),
        agent,
        status: agent?.agent_status ?? null,
      };
    })
    .filter((t): t is WorkspaceTab => t !== null);
  return {
    tabs,
    workspaceLabel: snapshot.workspaces.find((w) => w.workspace_id === workspaceId)?.label ?? null,
    panes: snapshot.panes,
  };
}
