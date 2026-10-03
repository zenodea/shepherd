import { ChevronLeft, ChevronRight, CornerLeftUp, Folder as FolderIcon, GitBranch, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Folder, FoldersResult } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ListGroup, ListRow } from "../ui/ListRow";
import { Divider } from "../ui/Screen";
import { colors, fonts, space, type, themed } from "../ui/theme";
import { shortPath } from "./agents";

function FolderRows({ folders, onOpen, onPick }: { folders: Folder[]; onOpen?: (f: Folder) => void; onPick?: (f: Folder) => void }) {
  return (
    <ListGroup>
      {folders.map((f, i) => (
        <View key={f.path}>
          {i > 0 ? <Divider inset={56} /> : null}
          <ListRow
            icon={f.repo ? <GitBranch size={18} color={colors.muted} /> : <FolderIcon size={18} color={colors.muted} />}
            title={f.name}
            detail={onPick ? shortPath(f.path) : null}
            chevron={Boolean(onOpen)}
            onPress={() => (onOpen ? onOpen(f) : onPick?.(f))}
          />
        </View>
      ))}
    </ListGroup>
  );
}

/** Pick a folder on the computer for a new agent: suggestions, browsing from your home folder, or a typed path. */
export function FolderPicker({ client, visible, onClose, onPick }: { client: HostConnection | null; visible: boolean; onClose: () => void; onPick: (path: string) => void }) {
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<FoldersResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(
    (path: string | undefined) => {
      if (!client) return;
      client
        .call<FoldersResult>("shepherd.folders", path ? { path } : {})
        .then((r) => {
          setError(null);
          setResult(r);
          setAt(path);
        })
        .catch((err: Error) => setError(err.message));
    },
    [client],
  );

  useEffect(() => {
    if (visible) load(undefined);
  }, [visible, load]);

  const pick = (path: string) => {
    onPick(path);
    onClose();
  };
  const atHome = at === undefined;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <View style={styles.header}>
          {atHome ? (
            <IconButton label="Close" onPress={onClose}>
              <X size={20} color={colors.text} />
            </IconButton>
          ) : (
            <IconButton label="Back" onPress={() => load(result?.parent ?? undefined)}>
              <ChevronLeft size={22} color={colors.text} />
            </IconButton>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{atHome ? "Choose a folder" : (result?.path.split("/").pop() ?? "")}</Text>
            {!atHome && result ? (
              <Text style={styles.path} numberOfLines={1}>
                {shortPath(result.path)}
              </Text>
            ) : null}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.typeRow}>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={setTyped}
              placeholder="~/Work/project"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => typed.trim() && load(typed.trim())}
              returnKeyType="go"
            />
            <IconButton label="Open the typed folder" onPress={() => typed.trim() && load(typed.trim())}>
              <ChevronRight size={20} color={colors.text} />
            </IconButton>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!result ? (
            <ActivityIndicator style={{ marginTop: space.xl }} color={colors.muted} />
          ) : (
            <>
              {result.suggestions?.recent.length ? (
                <View>
                  <Text style={styles.label}>Recent</Text>
                  <FolderRows folders={result.suggestions.recent} onPick={(f) => pick(f.path)} />
                </View>
              ) : null}
              {result.suggestions?.repos.length ? (
                <View>
                  <Text style={styles.label}>Git repositories</Text>
                  <FolderRows folders={result.suggestions.repos} onPick={(f) => pick(f.path)} />
                </View>
              ) : null}
              <View>
                <Text style={styles.label}>{atHome ? "Browse your home folder" : "Folders"}</Text>
                {!atHome && result.parent ? (
                  <ListGroup>
                    <ListRow icon={<CornerLeftUp size={18} color={colors.muted} />} title="Up one folder" chevron={false} onPress={() => load(result.parent ?? undefined)} />
                  </ListGroup>
                ) : null}
                {result.folders.length ? (
                  <View style={!atHome && result.parent ? { marginTop: space.sm } : undefined}>
                    <FolderRows folders={result.folders} onOpen={(f) => load(f.path)} />
                  </View>
                ) : (
                  <Text style={styles.empty}>No folders in here.</Text>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {!atHome && result ? (
          <View style={styles.footer}>
            <Button title={`Use ${result.path.split("/").pop()}`} onPress={() => pick(result.path)} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
    title: { fontSize: 17, fontWeight: "600", color: colors.text },
    path: { fontSize: 12.5, color: colors.muted, fontFamily: fonts.mono },
    body: { gap: space.lg, paddingBottom: space.xl },
    typeRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg },
    input: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, color: colors.text, fontFamily: fonts.mono, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
    label: { ...type.sub, paddingHorizontal: space.lg + 4, paddingBottom: 8 },
    error: { color: colors.danger, fontSize: 13.5, marginHorizontal: space.lg },
    empty: { color: colors.muted, fontSize: 14, paddingHorizontal: space.lg + 4 },
    footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  }),
);
