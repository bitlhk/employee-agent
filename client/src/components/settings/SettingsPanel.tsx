import React, { useState, useEffect, useCallback } from "react";
import { getSettings, applySettings, subscribeSettings } from "../../lib/settings";
import { UiSettings } from "../../types/settings";
import "./SettingsPanel.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const SettingsPanel: React.FC<Props> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<UiSettings>(getSettings());

  useEffect(() => {
    return subscribeSettings((s) => setSettings({ ...s }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const update = useCallback((patch: Partial<UiSettings>) => {
    applySettings(patch);
  }, []);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">⚙️ 设置</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>🎨 外观</h3>

            <div className="settings-item">
              <label>主题</label>
              <div className="theme-picker">
                {(["default", "lavender", "ocean"] as const).map((t) => (
                  <button
                    key={t}
                    className={`theme-swatch theme-swatch--${t} ${(settings.theme as any) === t ? "active" : ""}`}
                    onClick={() => update({ theme: t as any })}
                    title={t === "default" ? "品牌红" : t === "lavender" ? "薰衣草" : "海洋蓝"}
                  >
                    <span className="theme-swatch-dot" />
                    <span className="theme-swatch-label">
                      {t === "default" ? "默认" : t === "lavender" ? "薰衣草" : "海洋"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <label>模式</label>
              <div className="btn-group">
                {(["system", "light", "dark"] as const).map((m) => (
                  <button
                    key={m}
                    className={`btn-group-item ${settings.themeMode === m ? "active" : ""}`}
                    onClick={() => update({ themeMode: m })}
                  >
                    {m === "system" ? "🌓 跟随系统" : m === "light" ? "☀️ 浅色" : "🌙 深色"}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <label>圆角 <span className="settings-value">{settings.borderRadius}</span></label>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.borderRadius}
                onChange={(e) => update({ borderRadius: Number(e.target.value) })}
                className="settings-slider"
              />
              <div className="radius-preview">
                <div className="radius-preview-box" style={{ borderRadius: "var(--radius-md)" }} />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3>💬 聊天</h3>
            {[
              { key: "chatShowThinking" as const, label: "显示思考过程", icon: "🧠" },
              { key: "chatShowToolCalls" as const, label: "显示工具调用", icon: "🔧" },
              { key: "chatFocusMode" as const, label: "专注模式", icon: "🎯" },
              { key: "chatAutoScroll" as const, label: "自动滚动", icon: "⬇️" },
            ].map(({ key, label, icon }) => (
              <div key={key} className="settings-item settings-toggle-row">
                <span>{icon} {label}</span>
                <button
                  className={`toggle ${settings[key] ? "on" : "off"}`}
                  onClick={() => update({ [key]: !settings[key] })}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
            ))}
          </section>

          <section className="settings-section">
            <h3>📐 布局</h3>
            <div className="settings-item settings-toggle-row">
              <span>🗂️ 收起导航栏</span>
              <button
                className={`toggle ${settings.navCollapsed ? "on" : "off"}`}
                onClick={() => update({ navCollapsed: !settings.navCollapsed })}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
            <div className="settings-item">
              <label>消息宽度</label>
              <div className="btn-group">
                {(["comfortable", "compact"] as const).map((m) => (
                  <button
                    key={m}
                    className={`btn-group-item`}
                    onClick={() => {}}
                  >
                    {m === "comfortable" ? "宽松" : "紧凑"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3>🌐 通用</h3>
            <div className="settings-item">
              <label>语言</label>
              <div className="btn-group">
                {(["zh-CN", "en"] as const).map((l) => (
                  <button
                    key={l}
                    className={`btn-group-item ${settings.locale === l ? "active" : ""}`}
                    onClick={() => update({ locale: l })}
                  >
                    {l === "zh-CN" ? "🇨🇳 中文" : "🇺🇸 English"}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
