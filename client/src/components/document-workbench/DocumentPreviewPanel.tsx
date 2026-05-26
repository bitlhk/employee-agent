import type { ReactNode } from "react";
import { Download, Maximize2, X } from "lucide-react";

type DocumentPreviewPanelProps = {
  title: string;
  subtitle?: string;
  downloadUrl?: string;
  onClose: () => void;
  onFullscreen?: () => void;
  children: ReactNode;
};

export function DocumentPreviewPanel({ title, subtitle = "右侧统一预览", downloadUrl, onClose, onFullscreen, children }: DocumentPreviewPanelProps) {
  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border bg-white shadow-[0_12px_36px_rgba(15,23,42,0.08)] transition-all duration-[250ms] ease-out"
      style={{ borderColor: "#EAEAEA" }}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: "#F0F0F0" }}>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{title}</div>
          <div className="text-xs" style={{ color: "var(--oc-text-tertiary)" }}>{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {onFullscreen ? (
            <button type="button" onClick={onFullscreen} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="全屏预览">
              <Maximize2 size={18} />
            </button>
          ) : null}
          {downloadUrl ? (
            <a href={downloadUrl} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="下载">
              <Download size={18} />
            </a>
          ) : null}
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--oc-muted)" }} title="关闭预览">
            <X size={18} />
          </button>
        </div>
      </div>
      {children}
    </aside>
  );
}
