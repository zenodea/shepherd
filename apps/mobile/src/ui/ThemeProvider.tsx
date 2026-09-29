import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { loadPref, savePref } from "../connection/prefs";
import { THEMES, applyTheme, themeVersion, type ThemeId, type ThemeMode } from "./theme";

type ThemeContextValue = {
  theme: ThemeId;
  mode: ThemeMode;
  /** Whether the dark variant is showing (resolves "system"). */
  dark: boolean;
  /** Bumped on every change; screens key their content on it to redraw. */
  version: number;
  setTheme: (theme: ThemeId) => void;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isThemeId = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);
const isMode = (v: string | null): v is ThemeMode => v === "system" || v === "dark" || v === "light";

/** Holds the chosen theme and light/dark mode, and applies them to the live tokens. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [theme, setThemeState] = useState<ThemeId>("default");
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    void Promise.all([loadPref("theme"), loadPref("themeMode")]).then(([t, m]) => {
      if (isThemeId(t)) setThemeState(t);
      if (isMode(m)) setModeState(m);
    });
  }, []);

  const dark = mode === "system" ? system !== "light" : mode === "dark";

  // Apply during render, before any child reads the tokens.
  const [applied, setApplied] = useState<{ theme: ThemeId; dark: boolean; version: number }>(() => {
    applyTheme("default", true);
    return { theme: "default", dark: true, version: themeVersion() };
  });
  if (applied.theme !== theme || applied.dark !== dark) {
    applyTheme(theme, dark);
    setApplied({ theme, dark, version: themeVersion() });
  }

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    void savePref("theme", next);
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void savePref("themeMode", next);
  }, []);

  const value = useMemo(
    () => ({ theme, mode, dark, version: applied.version, setTheme, setMode }),
    [theme, mode, dark, applied.version, setTheme, setMode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
