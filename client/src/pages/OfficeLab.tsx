import { useMemo, useState } from "react";
import { Bot, ChevronLeft, CircleDot, MessageSquarePlus, Sparkles, Users } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

type OfficeAgent = {
  id: string;
  adoptId: string;
  agentId: string;
  name: string;
  role: string;
  group: string;
  status: string;
  entryUrl?: string;
  profile: AvatarProfile;
};

type AvatarProfile = {
  skin: string;
  hair: string;
  top: string;
  pants: string;
  shoes: string;
  hairStyle: "short" | "parted" | "spiky" | "bun";
  accessory: "none" | "headset" | "glasses" | "cap";
};

const skinTones = ["#f7d7c2", "#f4c58a", "#d8a06e", "#b7794e", "#8a5a3b", "#5d3a24"];
const hairColors = ["#151515", "#3e2723", "#6b4f3a", "#7b341e", "#d6b56c", "#0891b2"];
const topColors = ["#2d3748", "#4567d8", "#1f9d72", "#b91c1c", "#7c3aed", "#64748b"];
const pantsColors = ["#1f2937", "#334155", "#1e3a8a", "#475569", "#3f3f46"];
const shoeColors = ["#1a1a1a", "#1e3a8a", "#7c4a2d", "#e5e7eb"];
const hairStyles: AvatarProfile["hairStyle"][] = ["short", "parted", "spiky", "bun"];
const accessories: AvatarProfile["accessory"][] = ["none", "headset", "glasses", "cap"];

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pick = <T,>(values: T[], index: number) => values[index % values.length];

const avatarFromSeed = (seed: string): AvatarProfile => {
  const hash = hashSeed(seed || "agent");
  return {
    skin: pick(skinTones, hash),
    hair: pick(hairColors, hash >>> 3),
    top: pick(topColors, hash >>> 6),
    pants: pick(pantsColors, hash >>> 9),
    shoes: pick(shoeColors, hash >>> 12),
    hairStyle: pick(hairStyles, hash >>> 15),
    accessory: pick(accessories, hash >>> 18),
  };
};

const mockAgents: OfficeAgent[] = [
  { id: "mock-1", adoptId: "lgc-demo-analyst", agentId: "trial_lgc-demo-analyst", name: "债券助手", role: "债券报价解析", group: "中队专区", status: "active", profile: avatarFromSeed("bond-agent") },
  { id: "mock-2", adoptId: "lgc-demo-rm", agentId: "trial_lgc-demo-rm", name: "财富助手", role: "客户经理财富助手", group: "金融专业", status: "active", profile: avatarFromSeed("wealth-agent") },
  { id: "mock-3", adoptId: "lgc-demo-research", agentId: "trial_lgc-demo-research", name: "投研助手", role: "专业投研", group: "金融专业", status: "active", profile: avatarFromSeed("research") },
  { id: "mock-4", adoptId: "lgc-demo-office", agentId: "trial_lgc-demo-office", name: "办公助手", role: "文档与会议", group: "开源社区", status: "expiring", profile: avatarFromSeed("office") },
];

const seatLayout = [
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

function normalizeRole(row: any) {
  const profile = String(row?.permissionProfile || "").trim();
  if (profile === "internal") return "内部岗位智能体";
  if (profile === "plus") return "增强岗位智能体";
  if (profile === "starter") return "基础岗位智能体";
  return "岗位智能体";
}

function buildOfficeAgents(rows: any[] | undefined): OfficeAgent[] {
  const source = Array.isArray(rows) ? rows.filter((row) => ["active", "expiring", "creating"].includes(String(row?.status || ""))).slice(0, 9) : [];
  if (!source.length) return mockAgents;
  return source.map((row, index) => {
    const name = String(row?.userName || row?.userEmail || row?.adoptId || `成员 ${index + 1}`).trim();
    const adoptId = String(row?.adoptId || `agent-${index + 1}`);
    return {
      id: String(row?.id || adoptId),
      adoptId,
      agentId: String(row?.agentId || ""),
      name,
      role: normalizeRole(row),
      group: String(row?.groupName || row?.organizationName || "默认团队"),
      status: String(row?.status || "active"),
      entryUrl: String(row?.entryUrl || ""),
      profile: avatarFromSeed(`${adoptId}:${name}`),
    };
  });
}

function MiniClawAvatar({ profile }: { profile: AvatarProfile }) {
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

function OfficeDesk({ agent, selected, position, index, onSelect }: { agent: OfficeAgent; selected: boolean; position: { x: number; y: number }; index: number; onSelect: () => void }) {
  const online = agent.status === "active";
  return (
    <button
      className={`office-seat ${selected ? "office-seat--selected" : ""}`}
      style={{ left: `${position.x}%`, top: `${position.y}%`, ["--seat-index" as string]: index }}
      onClick={onSelect}
      type="button"
      aria-label={`查看 ${agent.name}`}
    >
      <div className="office-seat__desk">
        <div className="office-seat__screen" />
        <div className="office-seat__paper" />
      </div>
      <div className="office-seat__chair" />
      <MiniClawAvatar profile={agent.profile} />
      <div className="office-seat__nameplate">
        <span className={`office-seat__dot ${online ? "office-seat__dot--online" : ""}`} />
        <strong>{agent.name}</strong>
        <small>{agent.role}</small>
      </div>
    </button>
  );
}

export default function OfficeLab() {
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = trpc.claw.adminList.useQuery({ status: "all" }, { retry: false });
  const agents = useMemo(() => buildOfficeAgents((data as any)?.rows), [data]);
  const selectedAgent = agents.find((agent) => agent.id === selectedId) || agents[0];

  return (
    <div className="office-lab-page">
      <header className="office-lab-header">
        <button className="office-lab-back" type="button" onClick={() => setLocation("/")}>
          <ChevronLeft size={17} />
          返回
        </button>
        <div>
          <p>协作空间实验</p>
          <h1>岗位智能体团队看板</h1>
        </div>
        <div className="office-lab-header__meta">
          <span><Users size={15} /> {agents.length} 个工位</span>
          <span><Sparkles size={15} /> Claw3D 风格形象</span>
        </div>
      </header>

      <main className="office-lab-shell">
        <section className="office-map-panel">
          <div className="office-map-toolbar">
            <div>
              <h2>灵感团队办公室</h2>
              <p>{isLoading ? "正在读取平台智能体…" : "点击工位查看岗位智能体信息，当前仅做展示，不开放直接进入他人对话。"}</p>
            </div>
            <span className="office-map-badge">Preview</span>
          </div>
          <div className="office-map">
            <div className="office-map__floor" />
            <div className="office-map__zone office-map__zone--left">工位区</div>
            <div className="office-map__zone office-map__zone--right">专业小组</div>
            {agents.map((agent, index) => (
              <OfficeDesk
                key={agent.id}
                agent={agent}
                selected={selectedAgent?.id === agent.id}
                position={seatLayout[index % seatLayout.length]}
                index={index}
                onSelect={() => setSelectedId(agent.id)}
              />
            ))}
          </div>
        </section>

        <aside className="office-agent-panel">
          {selectedAgent ? (
            <>
              <div className="office-agent-panel__avatar">
                <MiniClawAvatar profile={selectedAgent.profile} />
              </div>
              <div className="office-agent-panel__title">
                <span className={`office-agent-status office-agent-status--${selectedAgent.status}`}>
                  <CircleDot size={12} />
                  {selectedAgent.status === "active" ? "可协作" : selectedAgent.status}
                </span>
                <h2>{selectedAgent.name}</h2>
                <p>{selectedAgent.role}</p>
              </div>
              <div className="office-agent-facts">
                <div>
                  <span>所属团队</span>
                  <strong>{selectedAgent.group}</strong>
                </div>
                <div>
                  <span>智能体实例</span>
                  <strong>{selectedAgent.adoptId}</strong>
                </div>
                <div>
                  <span>运行身份</span>
                  <strong>{selectedAgent.agentId || "未配置"}</strong>
                </div>
              </div>
              <div className="office-agent-actions">
                <button type="button">
                  <MessageSquarePlus size={16} />
                  发起协作
                </button>
                <button type="button" className="office-agent-actions__secondary">
                  <Bot size={16} />
                  查看能力
                </button>
              </div>
              <p className="office-agent-note">
                第一版只做空间化展示。后续这里可以接入现有协作任务，而不是直接打开对方主对话。
              </p>
            </>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
