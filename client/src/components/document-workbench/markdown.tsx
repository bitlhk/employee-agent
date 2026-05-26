import type { ReactNode } from "react";

export function DocumentMarkdownFrame({ compact, children }: { compact?: boolean; children: ReactNode }) {
  return (
    <article className={compact ? "rounded-xl bg-white/80 px-4 py-3 text-[13px] leading-6 shadow-sm" : "max-w-none px-1 pb-2"} style={{ color: "var(--oc-text-primary)" }}>
      {children}
    </article>
  );
}
