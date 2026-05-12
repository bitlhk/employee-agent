import React, { useEffect, useState } from "react";
import { Palette, type LucideIcon } from "lucide-react";
import { applySettings, getSettings, subscribeSettings } from "@/lib/settings";
import type { UiSettings } from "@/types/settings";

type Section = "appearance";

const SECTIONS: { key: Section; label: string; icon: LucideIcon }[] = [
  { key: "appearance", label: "外观", icon: Palette },
];

const THEMES = [
  { key: "claw" as const, label: "Claw", desc: "珊瑚红 · 默认" },
  { key: "knot" as const, label: "Knot", desc: "深红 · 高对比" },
  { key: "dash" as const, label: "Dash", desc: "棕金 · 仪表盘" },
  { key: "ember" as const, label: "Ember", desc: "余烬 · 文学暖感" },
];

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-page-row">
      <span className="settings-page-row__label">{label}</span>
      <div className="settings-page-row__control">{children}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, label, desc }: { icon: LucideIcon; label: string; desc?: string }) {
  return (
    <div className="settings-section-title">
      <h3 className="settings-section-title__heading">
        <Icon className="settings-section-title__icon" aria-hidden="true" />
        {label}
      </h3>
      {desc && <p className="settings-section-title__desc">{desc}</p>}
    </div>
  );
}

export function SettingsPage() {
  const [uiSettings, setUiSettings] = useState<UiSettings>(getSettings());

  useEffect(() => subscribeSettings((s) => setUiSettings({ ...s })), []);

  return (
    <main className="settings-page">
      <div className="settings-page-content">
        <div id="settings-panel-appearance" className="settings-page-panel">
            <SectionTitle icon={Palette} label={SECTIONS[0].label} desc="主题、配色和界面圆角" />

            <div className="settings-page-group">
              <div className="settings-page-group__label">主题</div>
              <div className="settings-theme-grid">
                {THEMES.map((t) => {
                  const active = uiSettings.theme === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => applySettings({ theme: t.key })}
                      className={`settings-theme-card settings-theme-card--${t.key}`}
                      data-active={active ? "true" : "false"}
                    >
                      <div className="settings-theme-card__swatches">
                        <span className="settings-theme-card__accent" />
                        <span className="settings-theme-card__surface" />
                        <span className="settings-theme-card__border" />
                      </div>
                      <div>
                        <div className="settings-theme-card__title">{t.label}</div>
                        <div className="settings-theme-card__desc">{t.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <SettingRow label="色彩模式">
              <div className="settings-segmented">
                {([
                  { key: "system" as const, label: "跟随系统" },
                  { key: "light" as const, label: "浅色" },
                  { key: "dark" as const, label: "深色" },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => applySettings({ themeMode: m.key })}
                    className="settings-segmented__item"
                    data-active={uiSettings.themeMode === m.key ? "true" : "false"}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </SettingRow>

            <SettingRow label={`圆角 · ${uiSettings.borderRadius}`}>
              <div className="settings-range-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={25}
                  value={uiSettings.borderRadius}
                  onChange={(e) => applySettings({ borderRadius: Number(e.target.value) })}
                  className="settings-range"
                />
                <div
                  className="settings-radius-preview"
                  style={{
                    borderRadius: `${Math.round((12 * uiSettings.borderRadius) / 50)}px`,
                  }}
                />
              </div>
            </SettingRow>
        </div>
      </div>
    </main>
  );
}
