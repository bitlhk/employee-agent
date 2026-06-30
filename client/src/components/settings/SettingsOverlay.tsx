import { useEffect, useState } from "react";
import { Monitor, Palette, Settings2, X } from "lucide-react";
import { applySettings, getSettings, subscribeSettings } from "@/lib/settings";
import type { UiSettings } from "@/types/settings";

type SettingsTab = "appearance";

type DiagnosticStatus = "ok" | "warning" | "error" | "pending" | "skip";

export type SettingsHealthDiagnostics = {
  connection?: {
    status: DiagnosticStatus;
    title: string;
    detail?: string;
  };
  model?: {
    status: DiagnosticStatus;
    title: string;
    detail?: string;
  };
  openclaw?: {
    status: DiagnosticStatus;
    title: string;
    detail?: string;
    issues?: Array<{ code?: string; severity?: string; message?: string }>;
  };
  history?: {
    status: DiagnosticStatus;
    title: string;
    detail?: string;
  };
  mcp?: {
    status: DiagnosticStatus;
    title: string;
    detail?: string;
  };
  load?: {
    totalMs?: number;
    metrics: Array<{
      key: string;
      label: string;
      status: DiagnosticStatus;
      elapsedMs: number;
      requestMs?: number;
      detail?: string;
    }>;
  };
};

type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  adoptId: string;
  skills?: { shared?: any[]; system?: any[]; private?: any[] };
  defaultTab?: SettingsTab;
  diagnostics?: SettingsHealthDiagnostics;
};

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ key: SettingsTab; label: string; icon: any; disabled?: boolean }>;
}> = [
  {
    label: "偏好",
    items: [
      { key: "appearance", label: "外观", icon: Palette },
    ],
  },
];

function AppearanceSettings() {
  const [uiSettings, setUiSettings] = useState<UiSettings>(getSettings());

  useEffect(() => subscribeSettings((s) => setUiSettings({ ...s })), []);

  return (
    <section className="settings-overlay-section">
      <div className="settings-overlay-section__header">
        <h2>外观</h2>
        <p>调整界面色彩模式，整体风格保持克制统一。</p>
      </div>

      <div className="settings-overlay-card">
        <div className="settings-overlay-card__label">色彩模式</div>
        <div className="settings-mode-grid">
          {([
            { key: "light" as const, label: "浅色", desc: "适合日间办公", icon: Monitor },
            { key: "dark" as const, label: "深色", desc: "适合低光环境", icon: Monitor },
            { key: "system" as const, label: "自动", desc: "跟随系统设置", icon: Monitor },
          ] as const).map((mode) => {
            const Icon = mode.icon;
            const active = uiSettings.themeMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                className="settings-mode-card"
                data-active={active ? "true" : "false"}
                onClick={() => applySettings({ themeMode: mode.key })}
              >
                <Icon size={18} />
                <span className="settings-mode-card__copy">
                  <strong>{mode.label}</strong>
                  <span>{mode.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function SettingsOverlay({ open, onClose, defaultTab = "appearance" }: SettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);
  }, [defaultTab, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <button className="settings-overlay__scrim" type="button" aria-label="关闭设置" onClick={onClose} />
      <div className="settings-overlay__panel">
        <aside className="settings-overlay__nav">
          <div className="settings-overlay__brand">
            <Settings2 size={18} />
            <span>设置</span>
          </div>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="settings-overlay__group">
              <div className="settings-overlay__group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="settings-overlay__nav-item"
                    data-active={active ? "true" : "false"}
                    data-disabled={item.disabled ? "true" : "false"}
                    disabled={item.disabled}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="settings-overlay__content">
          <button type="button" className="settings-overlay__close" aria-label="关闭设置" onClick={onClose}>
            <X size={18} />
          </button>
          {activeTab === "appearance" ? <AppearanceSettings /> : null}
        </section>
      </div>
    </div>
  );
}
