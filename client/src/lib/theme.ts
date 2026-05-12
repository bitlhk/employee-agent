import { UiSettings } from "../types/settings";

export function resolveThemeMode(settings: UiSettings): "light" | "dark" {
  if (settings.themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return settings.themeMode;
}

export function applyResolvedTheme(settings: UiSettings): void {
  const root = document.documentElement;
  const resolvedMode = resolveThemeMode(settings);
  root.dataset.theme = settings.theme;
  root.dataset.themeMode = resolvedMode;
  root.style.colorScheme = resolvedMode;
  root.classList.toggle("dark", resolvedMode === "dark");
}

export function applyBorderRadius(value: number): void {
  const root = document.documentElement;
  const scale = value / 50;
  root.style.setProperty("--radius-sm", `${Math.round(4 * scale)}px`);
  root.style.setProperty("--radius-md", `${Math.round(8 * scale)}px`);
  root.style.setProperty("--radius-lg", `${Math.round(12 * scale)}px`);
  root.style.setProperty("--radius-xl", `${Math.round(16 * scale)}px`);
  root.style.setProperty("--radius-full", "9999px");
}

export function bindSystemThemeListener(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
