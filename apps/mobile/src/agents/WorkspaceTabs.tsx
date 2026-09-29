import { Plus, SquareTerminal } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AgentMark } from "../ui/AgentMark";
import { PressableScale } from "../ui/Pressable";
import { StatusIndicator } from "../ui/StatusIndicator";
import { colors, radii, statusLabels, themed } from "../ui/theme";
import type { WorkspaceTab } from "./use-workspace-tabs";

/** The workspace's herdr tabs (tmux-style windows), to switch the terminal between them. */
export function WorkspaceTabs({
  tabs,
  activePaneId,
  onSelect,
  onNew,
}: {
  tabs: WorkspaceTab[];
  activePaneId: string;
  onSelect: (tab: WorkspaceTab) => void;
  onNew: () => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.strip}>
      {tabs.map((tab) => {
        const active = tab.paneId === activePaneId;
        return (
          <PressableScale
            key={tab.tabId}
            onPress={() => onSelect(tab)}
            style={[styles.tab, active && styles.active]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${tab.label}${tab.status && tab.status !== "idle" && tab.status !== "unknown" ? `, ${statusLabels[tab.status]}` : ""}`}
          >
            {tab.agent ? (
              <AgentMark agent={tab.agent.agent} size={18} />
            ) : (
              <View style={styles.shellIcon}>
                <SquareTerminal size={13} color={colors.muted} />
              </View>
            )}
            <Text style={[styles.label, active && { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {tab.label}
            </Text>
            {tab.status && tab.status !== "idle" && tab.status !== "unknown" ? <StatusIndicator status={tab.status} size={6} /> : null}
          </PressableScale>
        );
      })}
      <PressableScale onPress={onNew} style={styles.add} accessibilityRole="button" accessibilityLabel="New terminal or agent in this workspace">
        <Plus size={16} color={colors.muted} />
      </PressableScale>
    </ScrollView>
  );
}

const styles = themed(() => StyleSheet.create({
  strip: { gap: 6, paddingHorizontal: 12, alignItems: "center" },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 32,
    paddingLeft: 6,
    paddingRight: 11,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  active: { backgroundColor: colors.raised, borderColor: colors.edge },
  shellIcon: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "500", color: colors.muted, maxWidth: 150 },
  add: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
}));
