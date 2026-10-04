// Pulls "what is the agent asking?" out of a blocked agent's visible screen,
// so it can be answered from the agent list. Agent CLIs render permission
// prompts as numbered option lists, e.g.
//
//    Do you want to make this edit to foo.ts?
//  ❯ 1. Yes
//    2. Yes, allow all edits during this session (shift+tab)
//    3. No, and tell Claude what to do differently (esc)

export type PromptOption = {
  /** herdr key-combo string that picks this option; several, space-separated, pressed in turn. */
  key: string;
  label: string;
  selected: boolean;
  /**
   * You write this answer yourself ("Type something.", "Other", "No, and
   * tell Claude what to do differently"): pick it, then type.
   */
  input?: boolean;
};

export type BlockedPrompt = {
  /** A few lines of context: the question, or the last lines on screen. */
  lines: string[];
  options: PromptOption[];
  /** Esc would stop the agent here (Codex while it works): don't offer it as a way out. */
  noCancel?: boolean;
};

const TAIL_LINES = 24;
const CONTEXT_LINES = 3;
const MAX_LABEL = 48;

// Box-drawing borders and padding that TUIs wrap prompts in.
const BORDER = /^[\s│┃║|╭╮╰╯┌┐└┘─━═]+|[\s│┃║|╭╮╰╯┌┐└┘─━═]+$/g;
const OPTION = /^(?:[❯›>▶→➤*•]\s*)?(\d{1,2})[.)]\s+(.+)$/;
const SELECTED_MARKER = /^[❯›>▶→➤*•]/;
// Trailing shortcut hint such as "(esc)", "(y)" or "(shift+tab)".
const HINT = /\s*\(([a-z0-9]+(?:\+[a-z0-9]+)*)\)\s*$/i;
// Only hints that are real herdr key names; "(recommended)" is just text.
const KEY_NAME = /^(?:[a-z0-9]|esc|escape|enter|tab|space|(?:ctrl|alt|shift)\+[a-z0-9]+)$/i;
const YES_NO = /[[(]\s*y\s*\/\s*n\s*[\])]/i;
// Options that ask you to write the answer.
const TEXT_OPTION = /^(?:type something|type (?:your|an?) (?:own )?(?:answer|response)|other\b|something else|no,? and tell \S+ what to do)/i;
// Codex asks while it keeps working: "? 1 question" / "shift+← to answer" until you open it…
const FOLDED_QUESTION = /^shift\+(?:←|left) to answer$/i;
const QUESTION_COUNT = /^\?\s*(\d+) questions?$/;
// …then a numbered list over "enter submit   ctrl+] skip   shift+→ main prompt".
const SKIP_HINT = /\bctrl\+\] skip\b/;
// pi's ask_user_question dialog ("Enter to select · ↑/↓ to navigate · n to add notes · …")
// ignores digits: an answer is arrow presses from the highlighted row, then Enter.
const ARROWS_ONLY = /↑\/↓ to navigate.*\bn to add notes\b/;
// Lines an option's description can take before the run of options counts as over.
const OPTION_GAP = 4;

function clean(line: string): string {
  return line.replace(BORDER, "").trimEnd();
}

/** "No, and tell Claude what to do differently" (and Codex's, and the others'): one short label for all of them. */
const TELL_INSTEAD = /^no,? and tell \S+ what to do(?: differently)?\b.*$/i;
const relabel = (label: string) => (TELL_INSTEAD.test(label) ? "Tell what to do differently" : label);

function truncate(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

function parseOption(line: string): PromptOption | null {
  const match = OPTION.exec(line.trim());
  if (!match) return null;
  const [, digit, rawLabel] = match;
  const found = HINT.exec(rawLabel!);
  const hint = found && KEY_NAME.test(found[1]!) ? found : null;
  const label = hint ? rawLabel!.slice(0, hint.index) : rawLabel!;
  return {
    key: hint ? hint[1]!.toLowerCase() : digit!,
    label: truncate(relabel(label.trim())),
    selected: SELECTED_MARKER.test(line.trim()),
    ...(TEXT_OPTION.test(label.trim()) ? { input: true } : {}),
  };
}

/** Keys as arrow presses from the highlighted option; Enter picks it, or for a write-your-own row, focusing it opens the text box. */
function byArrows(options: PromptOption[]): PromptOption[] {
  const from = Math.max(0, options.findIndex((o) => o.selected));
  return options.map((option, i) => {
    const moves: string[] = Array(Math.abs(i - from)).fill(i > from ? "down" : "up");
    return { ...option, key: [...moves, ...(option.input ? [] : ["enter"])].join(" ") };
  });
}

export function extractPrompt(screen: string): BlockedPrompt {
  const tail = screen
    .split("\n")
    .map(clean)
    .filter((line, i, all) => line.length > 0 || (i > 0 && all[i - 1]!.length > 0))
    .slice(-TAIL_LINES);

  const folded = tail.findIndex((l) => FOLDED_QUESTION.test(l.trim()));
  if (folded !== -1) {
    const count = Number(QUESTION_COUNT.exec(tail[folded - 1]?.trim() ?? "")?.[1] ?? 1);
    return {
      lines: [count > 1 ? `${count} questions are waiting.` : "A question is waiting."],
      options: [{ key: "shift+left", label: "Show the question", selected: false }],
      noCancel: true,
    };
  }

  // Find the last run of numbered options (allowing wrapped/blank lines between them).
  let end = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (parseOption(tail[i]!)) {
      end = i;
      break;
    }
  }

  if (end !== -1) {
    let start = end;
    for (let i = end - 1; i >= 0 && start - i <= OPTION_GAP; i--) {
      if (parseOption(tail[i]!)) start = i;
    }
    const options: PromptOption[] = [];
    const seen = new Set<string>();
    for (let i = start; i <= end; i++) {
      const option = parseOption(tail[i]!);
      if (option && !seen.has(option.label)) {
        seen.add(option.label);
        options.push(option);
      }
    }
    if (options.length >= 2) {
      const question = tail.slice(0, start).filter((l) => l.trim().length > 0).slice(-CONTEXT_LINES);
      const below = tail.slice(end + 1);
      if (below.some((l) => SKIP_HINT.test(l))) {
        return { lines: question, options: [...options, { key: "ctrl+]", label: "Skip", selected: false }], noCancel: true };
      }
      if (below.some((l) => ARROWS_ONLY.test(l))) return { lines: question, options: byArrows(options) };
      return { lines: question, options };
    }
  }

  const context = tail.filter((l) => l.trim().length > 0).slice(-CONTEXT_LINES);
  if (context.some((l) => YES_NO.test(l))) {
    return {
      lines: context,
      options: [
        { key: "y", label: "Yes", selected: false },
        { key: "n", label: "No", selected: false },
      ],
    };
  }
  return { lines: context, options: [] };
}
