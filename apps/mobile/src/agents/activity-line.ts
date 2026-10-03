/**
 * The live status line an agent draws while it works, from its screen: a
 * spinner, a few words, then the elapsed time in parentheses. Claude Code:
 * "· Baking… (5m 20s · ↓ 25.4k tokens)"; Codex: "• Working (34s • esc to
 * interrupt)". Transcripts only get a reply once it's finished, so this is
 * what shows the agent is alive in between.
 */
const STATUS = /^[^\p{L}\p{N}(]{1,4}\s*([^()]{1,60}?)\s*\(\s*((?:\d+h\s*)?(?:\d+m\s*)?\d+s)\b/u;

export function activityLine(screen: string): string | null {
  const lines = screen.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 20; i--) {
    const match = STATUS.exec(lines[i]!);
    if (match) return `${match[1]!.trim()} · ${match[2]!.replace(/\s+/g, " ")}`;
  }
  return null;
}
