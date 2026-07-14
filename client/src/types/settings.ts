export type ThemeMode = "system" | "light" | "dark";
export type ThemeName = "claw" | "knot" | "dash" | "ember";

export interface UiSettings {
  theme: ThemeName;
  themeMode: ThemeMode;
  borderRadius: number; // 0-100
  locale: string;

  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  chatFocusMode: boolean;
  chatAutoScroll: boolean;

  navCollapsed: boolean;
  navWidth: number;

  lastActiveAgentId?: string;
}

export const DEFAULT_SETTINGS: UiSettings = {
  theme: "claw",
  themeMode: "system",
  borderRadius: 50,
  locale: "zh-CN",
  chatShowThinking: true,
  chatShowToolCalls: true,
  chatFocusMode: false,
  chatAutoScroll: true,
  navCollapsed: false,
  navWidth: 220,
};
