import { Fragment, useMemo } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts, space, themed } from "../ui/theme";
import { inlineText, openableUrl, parseInline, parseMarkdown, type Align, type Inline, type MdBlock } from "./markdown-syntax";

const open = (url: string) => {
  if (openableUrl(url)) void Linking.openURL(url).catch(() => {});
};

function Spans({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "code":
            return (
              <Text key={i} style={styles.inlineCode}>
                {n.text}
              </Text>
            );
          case "bold":
            return (
              <Text key={i} style={styles.bold}>
                <Spans nodes={n.children} />
              </Text>
            );
          case "italic":
            return (
              <Text key={i} style={styles.italic}>
                <Spans nodes={n.children} />
              </Text>
            );
          case "strike":
            return (
              <Text key={i} style={styles.strike}>
                <Spans nodes={n.children} />
              </Text>
            );
          case "link":
            return openableUrl(n.url) ? (
              <Text key={i} style={styles.link} onPress={() => open(n.url)} accessibilityRole="link">
                <Spans nodes={n.children} />
              </Text>
            ) : (
              // A relative link (usually a file): its text, without pretending it opens.
              <Text key={i} style={styles.inlineCode}>
                {inlineText(n.children)}
              </Text>
            );
        }
      })}
    </>
  );
}

function Prose({ text, style }: { text: string; style?: object }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return (
    <Text style={[styles.prose, style]} selectable>
      <Spans nodes={nodes} />
    </Text>
  );
}

/** Roughly how wide a column needs to be for its longest cell, within limits. */
const cellWidth = (cell: string) =>
  parseInline(cell).reduce((w, n) => w + inlineText([n]).length * (n.kind === "code" ? 8.4 : n.kind === "bold" ? 8.4 : 7.9), 0);
const columnWidth = (cells: string[]) => Math.round(Math.min(260, Math.max(56, Math.max(...cells.map(cellWidth)) + 24)));
const textAlign = (a: Align) => (a === "center" ? "center" : a === "right" ? "right" : "left");

function Table({ block }: { block: Extract<MdBlock, { kind: "table" }> }) {
  const widths = useMemo(() => block.header.map((h, c) => columnWidth([h, ...block.rows.map((r) => r[c] ?? "")])), [block]);
  const row = (cells: string[], header: boolean, key: number) => (
    <View key={key} style={[styles.tr, header && styles.th, !header && key % 2 === 1 && styles.zebra]}>
      {cells.map((cell, c) => (
        <View key={c} style={[styles.td, { width: widths[c] }, c > 0 && styles.tdDivider]}>
          <Prose text={cell} style={[styles.cell, header && styles.bold, { textAlign: textAlign(block.align[c] ?? null) }]} />
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView horizontal style={styles.table} contentContainerStyle={styles.tableInner} showsHorizontalScrollIndicator={false}>
      <View>
        {row(block.header, true, -1)}
        {block.rows.map((r, i) => row(r, false, i))}
      </View>
    </ScrollView>
  );
}

function List({ block }: { block: Extract<MdBlock, { kind: "list" }> }) {
  return (
    <View style={styles.list}>
      {block.items.map((item, i) => (
        <View key={i} style={[styles.item, { paddingLeft: item.depth * 18 }]}>
          <Text style={[styles.prose, styles.bullet, item.checked !== null && styles.check]}>
            {item.checked === true ? "☑" : item.checked === false ? "☐" : /\d/.test(item.marker) ? item.marker.replace(")", ".") : item.depth > 0 ? "◦" : "•"}
          </Text>
          <View style={styles.itemBody}>
            <Prose text={item.text} style={item.checked === true ? styles.done : undefined} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <Prose text={block.text} />;
    case "heading":
      return <Prose text={block.text} style={block.level <= 2 ? styles.h1 : styles.h3} />;
    case "code":
      return (
        <ScrollView horizontal style={styles.codeBlock} contentContainerStyle={styles.codeBlockInner}>
          <Text style={styles.code} selectable>
            {block.text}
          </Text>
        </ScrollView>
      );
    case "list":
      return <List block={block} />;
    case "quote":
      return (
        <View style={styles.quote}>
          <Markdown text={block.text} />
        </View>
      );
    case "table":
      return <Table block={block} />;
    case "rule":
      return <View style={styles.rule} />;
  }
}

/** An agent's reply: headings, lists, tables, quotes, code and tappable links, drawn natively. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.markdown}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    markdown: { gap: space.sm },
    prose: { fontSize: 15, lineHeight: 22, color: colors.text },
    h1: { fontSize: 17, lineHeight: 24, fontWeight: "700", marginTop: 4 },
    h3: { fontWeight: "700" },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through", color: colors.muted },
    link: { color: colors.linkText, textDecorationLine: "underline" },
    inlineCode: { fontFamily: fonts.mono, fontSize: 13.5, color: colors.text, backgroundColor: colors.raised },
    codeBlock: { backgroundColor: colors.terminal, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, maxHeight: 360 },
    codeBlockInner: { padding: space.md },
    code: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18, color: colors.terminalText },
    list: { gap: 4 },
    item: { flexDirection: "row" },
    bullet: { minWidth: 18, color: colors.muted },
    check: { fontSize: 14 },
    itemBody: { flex: 1 },
    done: { color: colors.muted },
    quote: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: space.md, opacity: 0.85 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
    table: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, flexGrow: 0 },
    tableInner: { flexGrow: 0 },
    tr: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    th: { backgroundColor: colors.raised, borderTopWidth: 0 },
    zebra: { backgroundColor: colors.surface },
    td: { paddingHorizontal: 10, paddingVertical: 7 },
    tdDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
    cell: { fontSize: 13.5, lineHeight: 19 },
  }),
);
