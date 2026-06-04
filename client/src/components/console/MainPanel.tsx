import { SkillsPage } from "@/components/pages/SkillsPage";
import { ChannelsPage } from "@/components/pages/ChannelsPage";
import { AgentPage } from "@/components/pages/AgentPage";
import { WorkspacePage } from "@/components/pages/WorkspacePage";
import { OfficeSpacePage } from "@/components/pages/OfficeSpacePage";
import { SchedulePageV2 } from "@/components/pages/SchedulePageV2";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { MeetingNotesPage } from "@/components/pages/MeetingNotesPage";
import { CollabPage } from "@/components/pages/CollabPage";
import { PanelErrorBoundary } from "@/components/console/PanelErrorBoundary";
import type { PageKey } from "@/components/console/Sidebar";
import type { ReactNode } from "react";

function MainPanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col">
      {children}
    </div>
  );
}

export function MainPanel({
  activePage,
  skills,
  adoptId,
}: {
  activePage: Exclude<PageKey, "chat">;
  adoptId?: string;
  skills?: {
    data?: { shared: any[]; system: any[]; private: any[] } | null;
    canEdit?: boolean;
    pending?: boolean;
    onToggle?: (skillId: string, enable: boolean, source: "shared" | "system") => void;
  };
}) {
  const safeSkills = {
    data: skills?.data ?? { shared: [], system: [], private: [] },
    canEdit: !!skills?.canEdit,
    pending: !!skills?.pending,
    onToggle: skills?.onToggle ?? (() => {}),
    adoptId: adoptId || "",
  };

  let content: ReactNode;

  if (activePage === "weixin") content = <ChannelsPage adoptId={adoptId || ""} />;
  if (activePage === "skills") {
    content = <SkillsPage skills={safeSkills.data} canEdit={safeSkills.canEdit} pending={safeSkills.pending} onToggle={safeSkills.onToggle} adoptId={safeSkills.adoptId} />;
  }
  if (activePage === "agent") content = <AgentPage adoptId={adoptId || ""} skills={safeSkills.data as any} />;
  if (activePage === "workspace") content = <WorkspacePage adoptId={adoptId || ""} />;
  if (activePage === "office") content = <OfficeSpacePage adoptId={adoptId || ""} />;
  if (activePage === "schedule") content = <SchedulePageV2 adoptId={adoptId || ""} />;
  if (activePage === "meeting") content = <MeetingNotesPage adoptId={adoptId || ""} />;
  if (activePage === "collab") content = <CollabPage adoptId={adoptId || ""} />;

  return (
    <MainPanelShell>
      <PanelErrorBoundary
        resetKey={`${activePage}:${adoptId || ""}`}
        title="当前功能页暂时不可用"
        description="该功能页渲染时出现异常，侧栏和其他功能仍可继续使用。"
      >
        {content || <SettingsPage />}
      </PanelErrorBoundary>
    </MainPanelShell>
  );
}
