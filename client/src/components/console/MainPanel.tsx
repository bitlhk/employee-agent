import { SkillsPage } from "@/components/pages/SkillsPage";
import { ChannelsPage } from "@/components/pages/ChannelsPage";
import { AgentPage } from "@/components/pages/AgentPage";
import { WorkspacePage } from "@/components/pages/WorkspacePage";
import { SchedulePageV2 } from "@/components/pages/SchedulePageV2";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { DocsPage } from "@/components/pages/DocsPage";
import { CollabPage } from "@/components/pages/CollabPage";
import type { PageKey } from "@/components/console/Sidebar";

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

  if (activePage === "weixin") return <ChannelsPage adoptId={adoptId || ""} />;
  if (activePage === "skills") {
    return <SkillsPage skills={safeSkills.data} canEdit={safeSkills.canEdit} pending={safeSkills.pending} onToggle={safeSkills.onToggle} adoptId={safeSkills.adoptId} />;
  }
  if (activePage === "agent") return <AgentPage adoptId={adoptId || ""} skills={safeSkills.data as any} />;
  if (activePage === "workspace") return <WorkspacePage adoptId={adoptId || ""} />;
  if (activePage === "schedule") return <SchedulePageV2 adoptId={adoptId || ""} />;
  if (activePage === "docs") return <DocsPage />;
  if (activePage === "collab") return <CollabPage adoptId={adoptId || ""} />;

  return <SettingsPage />;
}
