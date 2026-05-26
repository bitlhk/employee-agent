import { FileText, Presentation } from "lucide-react";
import type { DocumentArtifactCardProps } from "./types";

export function DocumentArtifactCard({ name, typeLabel, sizeLabel, previewable, downloadUrl, onPreview }: DocumentArtifactCardProps) {
  const Icon = typeLabel === "PPT" ? Presentation : FileText;
  return (
    <div className="flex items-center gap-3 rounded-2xl border p-3 shadow-sm" style={{ borderColor: "var(--oc-border)", background: "var(--oc-card)" }}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--oc-bg-soft)", color: "var(--oc-accent)" }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="mt-0.5 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
          {typeLabel} {sizeLabel || ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {previewable ? (
          <button type="button" onClick={onPreview} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: "var(--oc-muted)", color: "var(--oc-text-primary)" }}>
            预览
          </button>
        ) : null}
        {downloadUrl ? (
          <a href={downloadUrl} className="rounded-full px-3 py-1.5 text-xs font-medium text-white" style={{ background: "var(--oc-accent)" }}>
            下载
          </a>
        ) : null}
      </div>
    </div>
  );
}
