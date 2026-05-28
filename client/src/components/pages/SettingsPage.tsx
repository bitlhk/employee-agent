import { useEffect, useState } from "react";
import { Monitor, Palette } from "lucide-react";
import { applySettings, getSettings, subscribeSettings } from "@/lib/settings";
import type { UiSettings } from "@/types/settings";

export function SettingsPage() {
  const [uiSettings, setUiSettings] = useState<UiSettings>(getSettings());

  useEffect(() => subscribeSettings((s) => setUiSettings({ ...s })), []);

  return (
    <main className="settings-page">
      <div className="settings-page-content">
        <div id="settings-panel-appearance" className="settings-page-panel">
          <div className="settings-section-title">
            <h3 className="settings-section-title__heading">
              <Palette className="settings-section-title__icon" aria-hidden="true" />
              外观
            </h3>
            <p className="settings-section-title__desc">调整界面色彩模式。</p>
          </div>

          <div className="settings-page-group">
            <div className="settings-page-group__label">色彩模式</div>
            <div className="settings-mode-grid">
              {([
                { key: "light" as const, label: "浅色", desc: "适合日间办公" },
                { key: "dark" as const, label: "深色", desc: "适合低光环境" },
                { key: "system" as const, label: "自动", desc: "跟随系统设置" },
              ] as const).map((mode) => {
                const active = uiSettings.themeMode === mode.key;
                return (
                  <button
                    key={mode.key}
                    type="button"
                    className="settings-mode-card"
                    data-active={active ? "true" : "false"}
                    onClick={() => applySettings({ themeMode: mode.key })}
                  >
                    <Monitor size={18} />
                    <span className="settings-mode-card__copy">
                      <strong>{mode.label}</strong>
                      <span>{mode.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
