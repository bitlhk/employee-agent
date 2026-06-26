import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/console/PageContainer";
import {
  ArrowLeft,
  Bot,
  CheckSquare2,
  CircleDot,
  Copy,
  ExternalLink,
  EyeOff,
  ListChecks,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { sessionStatusMeta } from "@/lib/coopStatus";
import { CoopNewForm } from "@/pages/CoopNew";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type PageMode = "list" | "create";
type FilterKey = "all" | "action" | "created" | "participating" | "completed";

type CoopSessionRow = {
  id: string;
  title?: string | null;
  status: string;
  creator_user_id?: number;
  creator_name?: string | null;
  total_members?: number;
  completed_members?: number;
  pending_members?: number;
  i_am_member?: boolean | number;
  i_am_creator?: boolean | number;
  my_request_status?: string | null;
  created_at?: string | Date | null;
  published_at?: string | Date | null;
};

type CoopCandidate = {
  userId: number;
  userName: string | null;
  userEmail: string | null;
  groupId: number | null;
  groupName: string | null;
  orgName: string | null;
  departmentName: string | null;
  teamName: string | null;
  adoptId: string | null;
  agentRoleTemplate?: string | null;
  adoptionStatus: string | null;
};

type CoopAvatarProfile = {
  skin: string;
  hair: string;
  top: string;
  pants: string;
  shoes: string;
  hairStyle: "short" | "parted" | "spiky" | "bun";
  accessory: "none" | "headset" | "glasses" | "cap";
};

const coopSkinTones = ["#f7d7c2", "#f4c58a", "#d8a06e", "#b7794e", "#8a5a3b", "#5d3a24"];
const coopHairColors = ["#151515", "#3e2723", "#6b4f3a", "#7b341e", "#d6b56c", "#0891b2"];
const coopTopColors = ["#2d3748", "#4567d8", "#1f9d72", "#b91c1c", "#7c3aed", "#64748b"];
const coopPantsColors = ["#1f2937", "#334155", "#1e3a8a", "#475569", "#3f3f46"];
const coopShoeColors = ["#1a1a1a", "#1e3a8a", "#7c4a2d", "#e5e7eb"];
const coopHairStyles: CoopAvatarProfile["hairStyle"][] = ["short", "parted", "spiky", "bun"];
const coopAccessories: CoopAvatarProfile["accessory"][] = ["none", "headset", "glasses", "cap"];

const coopSeatLayout = [
  { x: 12, y: 20 },
  { x: 38, y: 16 },
  { x: 64, y: 20 },
  { x: 22, y: 48 },
  { x: 50, y: 46 },
  { x: 76, y: 50 },
  { x: 13, y: 72 },
  { x: 39, y: 75 },
  { x: 65, y: 72 },
];

function coopHashSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function coopPick<T>(values: T[], index: number) {
  return values[index % values.length];
}

function coopAvatarFromSeed(seed: string): CoopAvatarProfile {
  const hash = coopHashSeed(seed || "coop-agent");
  return {
    skin: coopPick(coopSkinTones, hash),
    hair: coopPick(coopHairColors, hash >>> 3),
    top: coopPick(coopTopColors, hash >>> 6),
    pants: coopPick(coopPantsColors, hash >>> 9),
    shoes: coopPick(coopShoeColors, hash >>> 12),
    hairStyle: coopPick(coopHairStyles, hash >>> 15),
    accessory: coopPick(coopAccessories, hash >>> 18),
  };
}

function coopDisplayName(candidate: CoopCandidate) {
  return String(candidate.userName || candidate.userEmail || `成员 ${candidate.userId}`).trim();
}

function coopRoleLabel(candidate: CoopCandidate) {
  return candidate.teamName || candidate.departmentName || candidate.groupName || "协作成员";
}

const COOP_AGENT_ROLE_NAMES: Record<string, string> = {
  "investment-researcher": "投顾分析",
  "wealth-manager": "财富经理",
  "credential-compliance": "审核专员",
  "insurance-advisor": "保险顾问",
  "general-assistant": "通用助手",
};

function coopAgentRoleName(candidate: CoopCandidate) {
  const role = String(candidate.agentRoleTemplate || "").trim();
  return COOP_AGENT_ROLE_NAMES[role] || role || "通用助手";
}

function coopOrgUnitLabel(candidate: CoopCandidate) {
  return candidate.teamName || candidate.departmentName || candidate.groupName || candidate.orgName || "组织";
}

function isJiuwenCoopCandidate(candidate: CoopCandidate) {
  const adoptId = String(candidate.adoptId || "");
  return adoptId.startsWith("lgj-") && (!candidate.adoptionStatus || candidate.adoptionStatus === "active");
}

function prefillCoopMembers(members: CoopCandidate[]) {
  try {
    sessionStorage.setItem(
      "coop_prefill",
      JSON.stringify({
        members: members.map((candidate) => ({
          userId: candidate.userId,
          userName: candidate.userName,
          adoptId: candidate.adoptId,
        })),
      })
    );
  } catch {}
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function countOf(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function createdAtValue(session: CoopSessionRow) {
  const time = session.created_at ? new Date(session.created_at).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getSessionFlags(session: CoopSessionRow) {
  const total = countOf(session.total_members);
  const completed = countOf(session.completed_members);
  const pending = countOf(session.pending_members);
  const isCreator = truthy(session.i_am_creator);
  const isMember = truthy(session.i_am_member);
  const needMyAction = isMember && session.my_request_status === "pending";
  const readyToConsolidate =
    isCreator &&
    session.status === "running" &&
    completed > 0 &&
    completed >= Math.max(0, total - pending);

  return { total, completed, pending, isCreator, isMember, needMyAction, readyToConsolidate };
}

function roleLabel(session: CoopSessionRow) {
  const flags = getSessionFlags(session);
  if (flags.isCreator && flags.isMember) return "发起人 / 成员";
  if (flags.isCreator) return "发起人";
  if (flags.isMember) return "成员";
  return "旁观";
}

function progressLabel(session: CoopSessionRow) {
  const { total, completed, pending } = getSessionFlags(session);
  if (total <= 0) return "未分配";
  if (pending > 0) return `${completed}/${total} 已提交 · ${pending} 待响应`;
  return `${completed}/${total} 已提交`;
}

function nextActionLabel(session: CoopSessionRow) {
  const flags = getSessionFlags(session);
  if (flags.needMyAction) return "待你接收或调整子任务";
  if (flags.readyToConsolidate) return "成员已完成，等待你汇总发布";
  if (session.status === "inviting") return flags.pending > 0 ? `等待 ${flags.pending} 位成员接收` : "等待成员接收";
  if (session.status === "running") {
    if (flags.total > 0 && flags.completed < flags.total) return "等待成员提交结果";
    return "等待结果确认";
  }
  if (session.status === "consolidating") return "正在生成汇总草稿";
  if (session.status === "published") return "已发布给全部成员";
  if (session.status === "closed" || session.status === "dissolved") return "协作已结束";
  return "进入查看详情";
}

function sortSessions(list: CoopSessionRow[]) {
  return [...list].sort((a, b) => {
    const fa = getSessionFlags(a);
    const fb = getSessionFlags(b);
    const score = (flags: ReturnType<typeof getSessionFlags>, session: CoopSessionRow) => {
      if (flags.needMyAction) return 4;
      if (flags.readyToConsolidate) return 3;
      if (session.status === "running" || session.status === "inviting") return 2;
      if (session.status === "consolidating") return 1;
      return 0;
    };
    const delta = score(fb, b) - score(fa, a);
    if (delta !== 0) return delta;
    return createdAtValue(b) - createdAtValue(a);
  });
}

function CoopMiniAvatar({ profile }: { profile: CoopAvatarProfile }) {
  return (
    <div className="office-avatar" style={{
      ["--skin" as string]: profile.skin,
      ["--hair" as string]: profile.hair,
      ["--top" as string]: profile.top,
      ["--pants" as string]: profile.pants,
      ["--shoes" as string]: profile.shoes,
    }}>
      <div className="office-avatar__shadow" />
      <div className="office-avatar__leg office-avatar__leg--left" />
      <div className="office-avatar__leg office-avatar__leg--right" />
      <div className="office-avatar__shoe office-avatar__shoe--left" />
      <div className="office-avatar__shoe office-avatar__shoe--right" />
      <div className="office-avatar__body" />
      <div className="office-avatar__arm office-avatar__arm--left" />
      <div className="office-avatar__arm office-avatar__arm--right" />
      <div className="office-avatar__neck" />
      <div className="office-avatar__head">
        <span className="office-avatar__eye office-avatar__eye--left" />
        <span className="office-avatar__eye office-avatar__eye--right" />
        <span className="office-avatar__mouth" />
      </div>
      <div className={`office-avatar__hair office-avatar__hair--${profile.hairStyle}`} />
      {profile.accessory === "headset" ? <div className="office-avatar__headset" /> : null}
      {profile.accessory === "glasses" ? <div className="office-avatar__glasses" /> : null}
      {profile.accessory === "cap" ? <div className="office-avatar__cap" /> : null}
    </div>
  );
}

function CoopOfficeSeat({
  candidate,
  selected,
  active,
  selectable,
  position,
  index,
  onClick,
}: {
  candidate: CoopCandidate;
  selected: boolean;
  active: boolean;
  selectable: boolean;
  position: { x: number; y: number };
  index: number;
  onClick: () => void;
}) {
  const name = coopDisplayName(candidate);
  const profile = coopAvatarFromSeed(`${candidate.userId}:${candidate.adoptId || name}`);
  return (
    <button
      className={`office-seat coop-office-seat ${active ? "office-seat--selected" : ""} ${selected ? "coop-office-seat--checked" : ""}`}
      style={{ left: `${position.x}%`, top: `${position.y}%`, ["--seat-index" as string]: index }}
      onClick={onClick}
      type="button"
      aria-pressed={selectable ? selected : active}
      aria-label={`${selectable ? selected ? "取消选择" : "选择" : "查看"} ${name}`}
    >
      {selectable ? <span className="coop-office-seat__check">{selected ? "✓" : ""}</span> : null}
      <div className="office-seat__desk">
        <div className="office-seat__screen" />
        <div className="office-seat__paper" />
      </div>
      <div className="office-seat__chair" />
      <CoopMiniAvatar profile={profile} />
      <div className="office-seat__nameplate">
        <span className={`office-seat__dot ${candidate.adoptionStatus === "active" ? "office-seat__dot--online" : ""}`} />
        <strong>{name}</strong>
        <small>{coopRoleLabel(candidate)}</small>
      </div>
    </button>
  );
}

function CoopOfficeHome({
  onCreate,
  onShowList,
}: {
  onCreate: () => void;
  onShowList: () => void;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const wlQ = trpc.coop.isWhitelisted.useQuery();
  const { data, isLoading } = trpc.coop.mentionCandidates.useQuery(
    { limit: 9 },
    { enabled: Boolean(wlQ.data?.whitelisted) }
  );
  const candidates = ((data as CoopCandidate[]) || []).filter(isJiuwenCoopCandidate).slice(0, 9);
  const active = candidates.find((candidate) => candidate.userId === activeUserId) || candidates[0] || null;
  const orgName = active?.orgName || candidates.find((candidate) => candidate.orgName)?.orgName || "华为";

  const toggleSelect = (candidate: CoopCandidate) => {
    setSelectedIds((prev) =>
      prev.includes(candidate.userId)
        ? prev.filter((id) => id !== candidate.userId)
        : [...prev, candidate.userId]
    );
  };

  const handleSeatClick = (candidate: CoopCandidate) => {
    if (selectMode) {
      toggleSelect(candidate);
      return;
    }
    setActiveUserId(candidate.userId);
  };

  const startMultiCoop = () => {
    if (selectedIds.length === 0) {
      onCreate();
      return;
    }
    prefillCoopMembers(candidates.filter((candidate) => selectedIds.includes(candidate.userId)));
    onCreate();
  };

  return (
    <div className="coop-office-home">
      <div className="coop-office-home__toolbar">
        <div>
          <h2>协作空间</h2>
          <p>{wlQ.data?.message || `组织：${orgName} · 点击工位查看成员，或多选后发起协作。`}</p>
        </div>
        <div className="coop-office-home__actions">
          <Button variant="outline" size="sm" className="coop-office-action-btn" onClick={onShowList}>
            <ListChecks className="w-4 h-4" />
            协作清单
          </Button>
          <Button variant="outline" size="sm" className="coop-office-action-btn" onClick={() => {
            setSelectMode((value) => !value);
            setSelectedIds([]);
          }}>
            <UsersRound className="w-4 h-4" />
            {selectMode ? "退出选择" : "选择成员"}
          </Button>
          <button className="page-primary-action" onClick={startMultiCoop}>
            <Plus size={15} />
            发起协作
          </button>
        </div>
      </div>

      {!wlQ.data?.whitelisted && !wlQ.isLoading ? (
        <div className="coop-empty-state coop-empty-state--compact">
          <div className="coop-empty-state__title">暂未开通组织协作</div>
          <div className="coop-empty-state__desc">{wlQ.data?.message || "请先在后台加入协作空间。"}</div>
        </div>
      ) : (
        <div className="coop-office-layout">
          <section className="office-map-panel coop-office-map-panel">
            <div className="office-map-toolbar">
              <div>
                <h2>{orgName} 协作小组</h2>
                <p>{isLoading ? "正在读取协作成员…" : `可协作成员 ${candidates.length} 人`}</p>
              </div>
              <span className="office-map-badge">{selectMode ? `已选 ${selectedIds.length}` : "Space"}</span>
            </div>
            <div className="office-map">
              <div className="office-map__floor" />
              <div className="office-map__zone office-map__zone--left">协作成员</div>
              <div className="office-map__zone office-map__zone--right">组织空间</div>
              {candidates.map((candidate, index) => (
                <CoopOfficeSeat
                  key={candidate.userId}
                  candidate={candidate}
                  selected={selectedIds.includes(candidate.userId)}
                  active={active?.userId === candidate.userId}
                  selectable={selectMode}
                  position={coopSeatLayout[index % coopSeatLayout.length]}
                  index={index}
                  onClick={() => handleSeatClick(candidate)}
                />
              ))}
            </div>
          </section>

          <aside className="office-agent-panel coop-office-detail">
            {active ? (
              <>
                <div className="office-agent-panel__avatar">
                  <CoopMiniAvatar profile={coopAvatarFromSeed(`${active.userId}:${active.adoptId || coopDisplayName(active)}`)} />
                </div>
                <div className="office-agent-panel__title">
                  <span className={`office-agent-status office-agent-status--${active.adoptionStatus || "active"}`}>
                    <CircleDot size={12} />
                    {active.adoptionStatus === "active" ? "可协作" : active.adoptionStatus || "协作成员"}
                  </span>
                  <h2>{coopDisplayName(active)}</h2>
                  <p>{coopRoleLabel(active)}</p>
                </div>
                <div className="office-agent-facts">
                  <div>
                    <span>组织</span>
                    <strong>{active.orgName || orgName}</strong>
                  </div>
                  <div>
                    <span>部门/团队</span>
                    <strong>{active.departmentName || active.teamName || active.groupName || "未配置"}</strong>
                  </div>
                  <div>
                    <span>智能体实例</span>
                    <strong>{active.adoptId || "未配置"}</strong>
                  </div>
                </div>
                <div className="office-agent-actions">
                  <button type="button" onClick={() => {
                    setSelectMode(true);
                    setSelectedIds([active.userId]);
                  }}>
                    <MessageSquarePlus size={16} />
                    选择发起协作
                  </button>
                </div>
                <p className="office-agent-note">
                  这里展示的是当前协作空间内可邀请的成员。真正发起协作会进入现有多人协作表单分配子任务。
                </p>
              </>
            ) : (
              <div className="coop-empty-state coop-empty-state--compact">
                <div className="coop-empty-state__title">暂无协作成员</div>
                <div className="coop-empty-state__desc">请先在后台把成员加入同一个协作空间。</div>
              </div>
            )}
          </aside>
        </div>
      )}

      {selectMode ? (
        <div className="coop-office-selection-bar">
          <span>已选 {selectedIds.length} 人</span>
          <button type="button" onClick={() => { setSelectedIds([]); setSelectMode(false); }}>取消</button>
          <button type="button" className="coop-office-selection-bar__primary" onClick={startMultiCoop} disabled={selectedIds.length === 0}>
            发起协作
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CollabPage({ adoptId: _adoptId }: { adoptId: string }) {
  const [, setLocationCoop] = useLocation();
  const [mode, setMode] = useState<PageMode>("list");

  if (mode === "create") {
    return (
      <PageContainer title="协作工作台" icon={<Users size={18} />}>
        <div className="coop-workbench">
          <div className="coop-workbench__create-head">
            <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="lingxia-soft-action coop-back-button">
              <ArrowLeft className="w-4 h-4 mr-1" /> 返回协作工作台
            </Button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">发起多人协作</div>
              <div className="text-xs text-muted-foreground">选择成员、拆分子任务，并在成员提交后统一汇总。</div>
            </div>
          </div>
          <CoopNewForm
            onDone={(sid) => setLocationCoop(`/coop/${sid}`)}
            onCancel={() => setMode("list")}
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="协作工作台" icon={<Users size={18} />}>
      <div className="coop-workbench">
        <CoopWorkbenchDashboard
          onCreate={() => setMode("create")}
        />
      </div>
    </PageContainer>
  );
}

function CoopWorkbenchDashboard({ onCreate }: { onCreate?: () => void }) {
  const [, setLocationCoop] = useLocation();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const wlQ = trpc.coop.isWhitelisted.useQuery();
  const { data, isLoading } = trpc.coop.mentionCandidates.useQuery(
    { limit: 80 },
    { enabled: Boolean(wlQ.data?.whitelisted) }
  );
  const { data: myClawData } = trpc.claw.me.useQuery(undefined, { retry: false });
  const creatorAdoptId = (myClawData as any)?.adoption?.adoptId || (myClawData as any)?.adoptId || "lgc-creator";
  const createMut = trpc.coop.create.useMutation({
    onSuccess: (r) => {
      setSelectedIds([]);
      toast.success("协作已创建");
      setLocationCoop(`/coop/${r.sessionId}`);
    },
    onError: (error) => toast.error(error.message || "协作创建失败"),
  });
  const agents = useMemo(() => {
    return ((data as CoopCandidate[]) || [])
      .filter(isJiuwenCoopCandidate);
  }, [data]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((userId) => agents.some((agent) => agent.userId === userId)));
  }, [agents]);

  const selectedAgents = useMemo(() => {
    const selected = new Set(selectedIds);
    return agents.filter((agent) => selected.has(agent.userId));
  }, [agents, selectedIds]);

  const startWithSelected = () => {
    if (selectedAgents.length === 0) {
      toast.warning("请先选择至少一个协作智能体");
      return;
    }
    createMut.mutate({
      title: "未命名协作",
      originMessage: "",
      creatorAdoptId,
      members: selectedAgents.map((agent) => ({
        userId: agent.userId,
        targetAdoptId: agent.adoptId || `mock:${agent.userId}`,
        subtask: "等待协作群内消息",
      })),
    });
  };

  return (
    <div className="coop-dashboard-layout">
      <div className="coop-dashboard-main">
        <CoopSessionsWorkbench />
      </div>
      <div className="coop-dashboard-side">
        <div className="coop-side-tab" aria-label="可协作智能体数量">
          可协作智能体
          <span>{agents.length}</span>
        </div>
        <CoopAgentsPanel
          agents={agents}
          isLoading={isLoading}
          whitelisted={Boolean(wlQ.data?.whitelisted)}
          whitelistLoading={wlQ.isLoading}
          whitelistMessage={wlQ.data?.message}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onCreate={startWithSelected}
          creating={createMut.isPending}
        />
      </div>
    </div>
  );
}

function CoopAgentsPanel({
  agents,
  isLoading,
  whitelisted,
  whitelistLoading,
  whitelistMessage,
  selectedIds,
  setSelectedIds,
  onCreate,
  creating,
}: {
  agents: CoopCandidate[];
  isLoading: boolean;
  whitelisted: boolean;
  whitelistLoading: boolean;
  whitelistMessage?: string | null;
  selectedIds: number[];
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  onCreate?: () => void;
  creating?: boolean;
}) {
  const selectedAgents = useMemo(() => {
    const selected = new Set(selectedIds);
    return agents.filter((agent) => selected.has(agent.userId));
  }, [agents, selectedIds]);

  const toggleAgent = (agent: CoopCandidate) => {
    setSelectedIds((prev) =>
      prev.includes(agent.userId)
        ? prev.filter((userId) => userId !== agent.userId)
        : [...prev, agent.userId]
    );
  };

  return (
    <aside className="coop-agents-panel" aria-label="可协作智能体">
      <div className="coop-agent-list-wrap">
        {!whitelisted && !whitelistLoading ? (
          <div className="coop-agents-panel__empty">{whitelistMessage || "当前用户未开通组织协作。"}</div>
        ) : isLoading ? (
          <div className="coop-agents-panel__empty">正在读取智能体...</div>
        ) : agents.length === 0 ? (
          <div className="coop-agents-panel__empty">暂无可协作智能体。</div>
        ) : (
          <div className="coop-agent-list">
            {agents.map((agent) => {
              const name = coopDisplayName(agent);
              const role = coopAgentRoleName(agent);
              const orgUnit = coopOrgUnitLabel(agent);
              const selected = selectedIds.includes(agent.userId);
              return (
                <button
                  type="button"
                  className="coop-agent-card coop-agent-card--selectable"
                  data-selected={selected ? "true" : "false"}
                  key={`${agent.userId}:${agent.adoptId}`}
                  onClick={() => toggleAgent(agent)}
                  aria-pressed={selected}
                >
                  <span className="coop-agent-card__check" aria-hidden="true">
                    {selected ? <CheckSquare2 size={16} /> : <Square size={16} />}
                  </span>
                  <div className="coop-agent-card__icon">
                    <Bot size={16} />
                  </div>
                  <div className="coop-agent-card__body">
                    <div className="coop-agent-card__name">{name}</div>
                    <div className="coop-agent-card__role">{orgUnit} - {role}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="coop-selected-agents" data-empty={selectedAgents.length === 0 ? "true" : "false"}>
        <div className="coop-selected-agents__head">
          <span>已选智能体</span>
          {selectedAgents.length > 0 ? (
            <button type="button" onClick={() => setSelectedIds([])}>清空</button>
          ) : null}
        </div>
        {selectedAgents.length > 0 ? (
          <div className="coop-selected-agents__chips">
            {selectedAgents.map((agent) => (
              <span key={agent.userId}>{coopDisplayName(agent)}</span>
            ))}
          </div>
        ) : (
          <p>可多选后发起协作。</p>
        )}
      </div>

      <button type="button" className="page-primary-action coop-create-action" onClick={() => onCreate?.()} disabled={creating}>
        {creating ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
        {creating ? "创建中..." : selectedAgents.length > 0 ? `发起协作 (${selectedAgents.length})` : "发起协作"}
      </button>
    </aside>
  );
}

function CoopSessionsWorkbench() {
  const [, setLoc] = useLocation();
  const { confirm, dialog } = useConfirmDialog();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const { data: sessions, isLoading, isFetching, refetch } = trpc.coop.listMySessions.useQuery({ limit: 80 }, {
    refetchInterval: 10_000,
  });
  const list = ((sessions as CoopSessionRow[]) || []).map((session) => ({
    ...session,
    id: String(session.id || ""),
  })).filter((session) => session.id);
  const sorted = useMemo(() => sortSessions(list), [list]);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target?.closest?.("[data-coop-menu]") || target?.closest?.("[data-coop-menu-trigger]")) return;
      setOpenMenuId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenuId]);

  const softDeleteMut = trpc.coop.softDelete.useMutation({
    onSuccess: () => { toast.success("协作已删除"); setOpenMenuId(null); refetch(); },
    onError: (error) => toast.error(error.message || "删除失败"),
  });
  const toggleHideMut = trpc.coop.toggleHide.useMutation({
    onSuccess: () => { toast.success("已从你的列表隐藏"); setOpenMenuId(null); refetch(); },
    onError: (error) => toast.error(error.message || "操作失败"),
  });

  const stats = useMemo(() => {
    return sorted.reduce(
      (acc, session) => {
        const flags = getSessionFlags(session);
        if (flags.needMyAction) acc.action += 1;
        if (flags.readyToConsolidate) acc.ready += 1;
        if (session.status === "running" || session.status === "inviting" || session.status === "consolidating") acc.active += 1;
        if (session.status === "published" || session.status === "closed") acc.done += 1;
        return acc;
      },
      { action: 0, ready: 0, active: 0, done: 0 }
    );
  }, [sorted]);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "全部", count: sorted.length },
    { key: "action", label: "待我处理", count: stats.action },
    { key: "created", label: "我发起的", count: sorted.filter((session) => getSessionFlags(session).isCreator).length },
    { key: "participating", label: "我参与的", count: sorted.filter((session) => getSessionFlags(session).isMember && !getSessionFlags(session).isCreator).length },
    { key: "completed", label: "已结束", count: stats.done },
  ];

  const filtered = sorted.filter((session) => {
    const flags = getSessionFlags(session);
    if (activeFilter === "action") return flags.needMyAction;
    if (activeFilter === "created") return flags.isCreator;
    if (activeFilter === "participating") return flags.isMember && !flags.isCreator;
    if (activeFilter === "completed") return session.status === "published" || session.status === "closed";
    return true;
  });

  const handleDelete = async (session: CoopSessionRow) => {
    const ok = await confirm({
      title: "删除协作？",
      description: `确认删除协作「${session.title || session.id}」？\n\n所有成员的视图都会消失（软删除，30 天内可联系管理员恢复）。`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    softDeleteMut.mutate({ sessionId: session.id });
  };
  const handleHide = async (session: CoopSessionRow) => {
    const ok = await confirm({
      title: "隐藏协作？",
      description: `从你的列表隐藏「${session.title || session.id}」？\n\n仅影响你的视图，发起人和其他成员不受影响。`,
      confirmText: "隐藏",
    });
    if (!ok) return;
    toggleHideMut.mutate({ sessionId: session.id, hide: true });
  };
  const handleCopyId = async (session: CoopSessionRow) => {
    try {
      await navigator.clipboard.writeText(session.id);
      toast.success("协作 ID 已复制");
    } catch {
      toast.error("复制失败");
    } finally {
      setOpenMenuId(null);
    }
  };

  if (isLoading) {
    return (
      <>
        {dialog}
        <div className="coop-workbench__loading">加载协作任务...</div>
      </>
    );
  }

  if (sorted.length === 0) {
    return (
      <>
        {dialog}
        <div className="coop-workbench__list-head">
          <div className="coop-filter-tabs" role="tablist" aria-label="协作任务筛选">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="coop-filter-tab"
                data-active={activeFilter === filter.key}
                onClick={() => setActiveFilter(filter.key)}
              >
                {filter.label}
                <span>{filter.count}</span>
              </button>
            ))}
          </div>
          <div className="coop-workbench__actions">
            <Button variant="outline" size="sm" className="coop-refresh-button" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </div>
        <div className="coop-empty-state">
          <div className="coop-empty-state__icon"><UsersRound size={24} /></div>
          <div className="coop-empty-state__title">还没有协作任务</div>
          <div className="coop-empty-state__desc">你可以发起一个多人协作，让成员分别处理子任务后统一汇总。</div>
        </div>
      </>
    );
  }

  return (
    <>
      {dialog}
      <div className="coop-workbench__list-head">
        <div className="coop-filter-tabs" role="tablist" aria-label="协作任务筛选">
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="coop-filter-tab"
              data-active={activeFilter === filter.key}
              onClick={() => setActiveFilter(filter.key)}
            >
              {filter.label}
              <span>{filter.count}</span>
            </button>
          ))}
        </div>
        <div className="coop-workbench__actions">
          <Button variant="outline" size="sm" className="coop-refresh-button" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="coop-empty-state coop-empty-state--compact">
          <div className="coop-empty-state__title">当前筛选下没有任务</div>
          <div className="coop-empty-state__desc">切换到“全部”可以查看所有协作任务。</div>
        </div>
      ) : (
        <div className="coop-task-table" role="table" aria-label="协作任务列表">
          <div className="coop-task-table__head" role="row">
            <div>任务</div>
            <div>状态</div>
            <div>下一步</div>
            <div>角色</div>
            <div>进度</div>
            <div>创建时间</div>
            <div></div>
          </div>
          <div className="coop-task-table__body">
            {filtered.map((session) => {
              const meta = sessionStatusMeta(session.status);
              const flags = getSessionFlags(session);
              const progress = flags.total > 0 ? Math.min(100, Math.round((flags.completed / flags.total) * 100)) : 0;
              return (
                <div
                  key={session.id}
                  className="coop-task-row"
                  data-action={flags.needMyAction || flags.readyToConsolidate ? "true" : "false"}
                  onClick={() => setLoc(`/coop/${session.id}`)}
                  role="row"
                >
                  <div className="coop-task-row__title-cell">
                    <div className="coop-task-row__title-line">
                      {(flags.needMyAction || flags.readyToConsolidate) ? <span className="coop-task-row__dot" /> : null}
                      <span className="coop-task-row__title">{session.title || "未命名协作"}</span>
                    </div>
                    <div className="coop-task-row__meta">
                      发起人：{session.creator_name || `#${session.creator_user_id || "—"}`}
                    </div>
                  </div>
                  <div>
                    <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
                  </div>
                  <div className="coop-task-row__next">{nextActionLabel(session)}</div>
                  <div className="coop-task-row__role">
                    <UserRound size={13} />
                    {roleLabel(session)}
                  </div>
                  <div className="coop-task-row__progress">
                    <div className="coop-task-row__progress-label">{progressLabel(session)}</div>
                    <div className="coop-progress-bar" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="coop-task-row__date">{formatDate(session.created_at)}</div>
                  <div className="coop-task-row__actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      data-coop-menu-trigger
                      className="coop-task-row__more"
                      aria-label="更多操作"
                      aria-expanded={openMenuId === session.id}
                      onClick={() => setOpenMenuId(openMenuId === session.id ? null : session.id)}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenuId === session.id ? (
                      <div className="coop-row-menu" data-coop-menu role="menu" aria-label="协作任务操作">
                        <button type="button" className="coop-row-menu__item" onClick={() => { setOpenMenuId(null); setLoc(`/coop/${session.id}`); }}>
                          <ExternalLink size={14} />
                          打开协作
                        </button>
                        <button type="button" className="coop-row-menu__item" onClick={() => handleCopyId(session)}>
                          <Copy size={14} />
                          复制协作 ID
                        </button>
                        <div className="coop-row-menu__divider" />
                        {flags.isCreator ? (
                          <button type="button" className="coop-row-menu__item coop-row-menu__item--danger" onClick={() => handleDelete(session)} disabled={softDeleteMut.isPending}>
                            <Trash2 size={14} />
                            删除协作
                          </button>
                        ) : (
                          <button type="button" className="coop-row-menu__item" onClick={() => handleHide(session)} disabled={toggleHideMut.isPending}>
                            <EyeOff size={14} />
                            从我的列表隐藏
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
