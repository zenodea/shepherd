import { Puzzle, SquareTerminal } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Card, CardButton, CardRow, Tone } from "@shepherd/protocol";
import { HostCallError } from "../connection/host-client";
import { PressableScale } from "../ui/Pressable";
import { alpha, colors, radii, statusColors, themed, type } from "../ui/theme";
import { timeLabel } from "./activity";

const toneColor = (tone: Tone | undefined): string | null =>
  tone === "ok" ? statusColors.done : tone === "warn" ? statusColors.blocked : tone === "bad" ? colors.danger : null;

export const describeError = (err: unknown) =>
  err instanceof HostCallError && err.code === "invalid_message" ? "Update Shepherd on your computer: this version doesn't know about plugins." : (err as Error).message;

export const buttonKey = (card: Card, button: CardButton) => `${card.plugin}/${card.id}/${button.action ?? `pane:${button.pane}`}`;

export type ChipItem = { key: string; label: string; pane?: boolean; danger?: boolean; onPress: () => void };

export function PluginMark({ size = 28 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}>
      <Puzzle size={size * 0.54} color={colors.muted} />
    </View>
  );
}

function Row({ row }: { row: CardRow }) {
  switch (row.kind) {
    case "text":
      return (
        <View style={styles.textRow}>
          {row.label ? <Text style={type.caption}>{row.label}</Text> : null}
          <Text style={type.body} selectable>
            {row.value}
          </Text>
        </View>
      );
    case "badge": {
      const color = toneColor(row.tone) ?? colors.subtle;
      return (
        <View style={styles.badges}>
          <View style={styles.badge}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={styles.badgeText}>{row.text}</Text>
          </View>
        </View>
      );
    }
    case "list":
      return (
        <View style={styles.list}>
          {row.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.itemText} numberOfLines={2}>
                {item.text}
              </Text>
              {item.detail ? (
                <Text style={type.sub} numberOfLines={2}>
                  {item.detail}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      );
  }
}

function Chip({ item, busy, disabled }: { item: ChipItem; busy: boolean; disabled: boolean }) {
  const color = item.danger ? colors.danger : colors.text;
  return (
    <PressableScale onPress={item.onPress} disabled={disabled} style={[styles.chip, item.danger && styles.chipDanger, disabled && !busy && { opacity: 0.5 }]} accessibilityRole="button">
      {busy ? <ActivityIndicator size="small" color={color} /> : item.pane ? <SquareTerminal size={14} color={colors.muted} /> : null}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

export function Chips({ items, busy }: { items: ChipItem[]; busy: string | null }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.chips}>
      {items.map((item) => (
        <Chip key={item.key} item={item} busy={busy === item.key} disabled={busy !== null} />
      ))}
    </View>
  );
}

export const cardChips = (card: Card, onButton: (card: Card, button: CardButton) => void): ChipItem[] =>
  "body" in card
    ? card.body.buttons.map((button) => ({ key: buttonKey(card, button), label: button.label, pane: Boolean(button.pane), danger: button.tone === "bad", onPress: () => onButton(card, button) }))
    : [];

export function CardView({ card, busy, onButton, now }: { card: Card; busy: string | null; onButton: (card: Card, button: CardButton) => void; now: number }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{card.title}</Text>
        {card.updatedAt ? <Text style={type.caption}>{timeLabel(card.updatedAt, now)}</Text> : null}
      </View>
      {"error" in card ? (
        <View style={styles.error}>
          <Text style={[type.sub, { color: colors.danger }]}>{card.error}</Text>
        </View>
      ) : (
        <>
          {card.body.rows.map((row, i) => (
            <Row key={i} row={row} />
          ))}
          <Chips items={cardChips(card, onButton)} busy={busy} />
        </>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    mark: { backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
    card: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
    cardHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
    cardTitle: { fontSize: 13, fontWeight: "600", color: colors.muted },
    textRow: { gap: 2 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    badge: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.raised, borderRadius: radii.pill, paddingLeft: 10, paddingRight: 12, height: 28 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    badgeText: { fontSize: 13, fontWeight: "600", color: colors.text },
    list: { gap: 8 },
    item: { gap: 1, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.border },
    itemText: { fontSize: 14, fontWeight: "500", color: colors.text },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 },
    chip: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.raised, borderRadius: radii.pill, paddingHorizontal: 14, height: 36, maxWidth: 300 },
    chipDanger: { backgroundColor: alpha(colors.danger, 0.12) },
    chipText: { fontSize: 13.5, fontWeight: "500" },
    error: { backgroundColor: colors.dangerTint, borderRadius: radii.md, padding: 10, marginHorizontal: -4 },
  }),
);
