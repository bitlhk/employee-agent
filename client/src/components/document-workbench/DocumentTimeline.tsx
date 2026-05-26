import type { DocumentTimelineProps, DocumentUserPromptBubbleProps } from "./types";

export function DocumentUserPromptBubble({ prompt }: DocumentUserPromptBubbleProps) {
  if (!prompt) return null;
  return (
    <div className="mb-5 flex justify-end">
      <div className="max-w-[520px] rounded-xl border bg-white px-4 py-2 text-sm leading-6 shadow-sm" style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-primary)" }}>
        {prompt}
      </div>
    </div>
  );
}

export function DocumentTimeline({ compact, children }: DocumentTimelineProps) {
  return (
    <section className={compact ? "mt-5 border-l pl-4" : "mt-8 space-y-1"} style={compact ? { borderColor: "color-mix(in oklab, var(--oc-border) 72%, transparent)" } : undefined}>
      {children}
    </section>
  );
}
