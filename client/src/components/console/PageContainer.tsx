import type { ReactNode } from "react";

export function PageContainer({ title, desc, icon, action, children }: { title: string; desc?: string; icon?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <main className="h-full min-h-0 flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="h-full min-h-0 flex-1 overflow-y-auto px-6 py-5 stealth-scrollbar">{children}</div>
    </main>
  );
}
