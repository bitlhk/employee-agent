import type { ReactNode } from "react";
import { X } from "lucide-react";

type DocumentHistoryDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  children: ReactNode;
};

export function DocumentHistoryDrawer({ open, title, subtitle, query, onQueryChange, onClose, children }: DocumentHistoryDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}>
      <aside className="h-full w-full max-w-[420px] overflow-y-auto p-4 shadow-xl stealth-scrollbar" style={{ background: "var(--oc-bg-surface)", borderLeft: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="lingxia-toolbar-icon" title="关闭">
            <X size={16} />
          </button>
        </div>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索任务" className="mt-4 w-full rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
        <div className="mt-4 space-y-2">{children}</div>
      </aside>
    </div>
  );
}
