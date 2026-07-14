import { UiSettings, DEFAULT_SETTINGS, ThemeName, ThemeMode } from "../types/settings";
import { applyResolvedTheme, applyBorderRadius } from "./theme";

const STORAGE_KEY = "linggan_ui_settings";
let _settings: UiSettings = { ...DEFAULT_SETTINGS };
const _listeners: Array<(s: UiSettings) => void> = [];

function normalizeSettings(s: Partial<UiSettings>): UiSettings {
  const merged = { ...DEFAULT_SETTINGS, ...s };
  const validThemes: ThemeName[] = ["claw", "knot", "dash", "ember"];
  const validModes: ThemeMode[] = ["system", "light", "dark"];
  if (!validThemes.includes(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  if (!validModes.includes(merged.themeMode)) merged.themeMode = DEFAULT_SETTINGS.themeMode;
  merged.borderRadius = Math.max(0, Math.min(100, merged.borderRadius ?? 50));
  merged.navWidth = Math.max(160, Math.min(320, merged.navWidth ?? 220));
  return merged;
}

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      _settings = normalizeSettings(JSON.parse(raw));
    }
  } catch {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

export function saveSettings(s: UiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function getSettings(): UiSettings {
  return _settings;
}

export function applySettings(next: Partial<UiSettings>): void {
  _settings = normalizeSettings({ ..._settings, ...next });
  saveSettings(_settings);
  applyResolvedTheme(_settings);
  applyBorderRadius(_settings.borderRadius);
  _listeners.forEach((cb) => cb(_settings));
}

export function subscribeSettings(cb: (s: UiSettings) => void): () => void {
  _listeners.push(cb);
  return () => {
    const idx = _listeners.indexOf(cb);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}
