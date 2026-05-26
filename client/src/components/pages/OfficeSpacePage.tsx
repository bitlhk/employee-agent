import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Mic2,
  Presentation,
  Video,
} from "lucide-react";
import { DocumentTaskWorkbench } from "@/components/document-workbench/DocumentTaskWorkbench";

type OfficeSpacePageProps = {
  adoptId: string;
};

type CapabilityId =
  | "meeting-notes"
  | "excel-fill"
  | "ppt-create"
  | "video-outline"
  | "market-research-brief"
  | "meeting-prep-agent"
  | "wind-announcement-digest";

const capabilities: Array<{
  id: CapabilityId;
  title: string;
  shortTitle: string;
  description: string;
  placeholder: string;
  quickPrompts: string[];
  status: "ready" | "planned";
  category: "general" | "finance";
  Icon: typeof Mic2;
}> = [
  {
    id: "meeting-notes",
    title: "会议纪要",
    shortTitle: "会议纪要",
    description: "录音或上传音频，生成会议摘要、待办事项和派生版本。",
    placeholder: "上传会议录音，或粘贴会议转写并说明纪要要求",
    quickPrompts: [
      "上传会议录音，生成标准会议纪要",
      "从会议转写里提取待办事项",
      "整理成发给领导的简版纪要",
      "生成项目例会风险与决策清单",
    ],
    status: "ready",
    category: "general",
    Icon: Mic2,
  },
  {
    id: "excel-fill",
    title: "Excel 填表",
    shortTitle: "Excel填表",
    description: "上传表格和背景资料，先生成填表计划预览，再确认写回。",
    placeholder: "上传 Excel 和背景资料，说明填表规则",
    quickPrompts: [
      "只补空白，不覆盖已有内容",
      "按字段映射填写并标注依据",
      "补全客户资料表和风险提示",
      "补全项目台账和下一步动作",
    ],
    status: "ready",
    category: "general",
    Icon: FileSpreadsheet,
  },
  {
    id: "ppt-create",
    title: "幻灯片",
    shortTitle: "幻灯片",
    description: "基于材料生成页结构和大纲，确认后再生成演示文稿。",
    placeholder: "描述您的演示文稿主题",
    quickPrompts: [
      "生成 8 页智能体趋势 PPT",
      "银行业 AI Agent 趋势 PPT",
      "企业知识库工作台方案 PPT",
      "OpenClaw 部署方案 PPT",
    ],
    status: "ready",
    category: "general",
    Icon: Presentation,
  },
  {
    id: "video-outline",
    title: "视频提纲",
    shortTitle: "视频提纲",
    description:
      "输入公开的视频链接，分析主要内容并形成学习、汇报或 PPT 提纲。",
    placeholder: "输入公开视频链接和提纲要求",
    quickPrompts: [
      "分析视频主要内容，生成学习提纲",
      "整理成适合领导汇报的摘要",
      "提取课程知识点、案例和方法论",
      "输出适合做 PPT 的章节结构",
    ],
    status: "ready",
    category: "general",
    Icon: Video,
  },
  {
    id: "market-research-brief",
    title: "市场研究简报",
    shortTitle: "市场简报",
    description: "围绕市场、行业或公司主题，检索资料并生成结构化研究简报。",
    placeholder: "输入金融市场、行业、公司或监管主题",
    quickPrompts: [
      "洞察近期金融 AI 应用趋势",
      "分析跨境支付最新动态",
      "梳理财富管理 AI Agent 机会",
      "研究企业智能体平台市场机会",
    ],
    status: "ready",
    category: "finance",
    Icon: BarChart3,
  },
  {
    id: "meeting-prep-agent",
    title: "客户会议准备",
    shortTitle: "客户会议",
    description: "整理客户背景、近期动态、沟通议题和会前问题清单。",
    placeholder: "输入客户、机构、会议目标和关注方向",
    quickPrompts: [
      "准备拜访某银行科技部",
      "准备金融机构高层交流",
      "梳理客户续约会议材料",
      "生成平台介绍沟通主线",
    ],
    status: "ready",
    category: "finance",
    Icon: FileText,
  },
  {
    id: "wind-announcement-digest",
    title: "公告解读",
    shortTitle: "公告解读",
    description: "基于公告和财经新闻，生成公告事实、影响路径和风险跟踪清单。",
    placeholder: "输入公司、股票或公告主题",
    quickPrompts: [
      "解读贵州茅台最新公告",
      "分析宁德时代公告风险",
      "梳理年报核心变化",
      "解读回购公告影响",
    ],
    status: "ready",
    category: "finance",
    Icon: FileSearch,
  },
];

const generalCapabilities = capabilities.filter(
  item => item.category === "general"
);
const financeCapabilities = capabilities.filter(
  item => item.category === "finance"
);

const workbenchTemplateIds = [
  "research_ppt",
  "meeting_notes",
  "excel_fill",
  "video_outline",
  "market_research_brief",
  "wind_announcement_digest",
  "meeting_prep_agent",
];

function CapabilityCard({
  capability,
  onClick,
}: {
  capability: (typeof capabilities)[number];
  onClick: () => void;
}) {
  const Icon = capability.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-3 text-left transition-colors"
      style={{
        background: "var(--oc-bg-surface)",
        border: "1px solid var(--oc-border)",
        color: "var(--oc-text-primary)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-md"
          style={{
            background:
              "color-mix(in oklab, var(--oc-accent) 12%, transparent)",
            color: "var(--oc-accent)",
          }}
        >
          <Icon size={18} />
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px]"
          style={{
            background:
              capability.status === "ready"
                ? "color-mix(in oklab, var(--oc-accent) 12%, transparent)"
                : "var(--oc-panel)",
            color:
              capability.status === "ready"
                ? "var(--oc-accent)"
                : "var(--oc-text-tertiary)",
            border: "1px solid var(--oc-border)",
          }}
        >
          {capability.status === "ready" ? "可用" : "规划中"}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold">{capability.title}</h3>
      <p
        className="mt-1.5 text-xs leading-5"
        style={{ color: "var(--oc-text-secondary)" }}
      >
        {capability.description}
      </p>
    </button>
  );
}

function PlannedCapabilityPage({
  title,
  kind,
  onBack,
}: {
  title: string;
  kind: "excel" | "ppt";
  onBack: () => void;
}) {
  const isExcel = kind === "excel";
  return (
    <main
      className="h-full min-h-0 overflow-y-auto stealth-scrollbar"
      style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}
    >
      <div className="mx-auto max-w-5xl px-5 py-5 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          style={{
            color: "var(--oc-text-secondary)",
            border: "1px solid var(--oc-border)",
            background: "var(--oc-panel)",
          }}
        >
          <ArrowLeft size={15} />
          返回办公空间
        </button>

        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex items-center gap-3">
            {isExcel ? (
              <FileSpreadsheet
                size={20}
                style={{ color: "var(--oc-accent)" }}
              />
            ) : (
              <Presentation size={20} style={{ color: "var(--oc-accent)" }} />
            )}
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--oc-text-secondary)" }}
              >
                第一版先确定统一骨架：输入资料、填写要求、生成预览、保存到文件。具体生成能力后续按
                contract 接入 OpenClaw。
              </p>
            </div>
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <h3 className="text-sm font-semibold">输入</h3>
          <div className="mt-4 grid gap-3">
            <div
              className="rounded-md p-3"
              style={{
                background: "var(--oc-panel)",
                border: "1px solid var(--oc-border)",
              }}
            >
              <div className="text-sm font-medium">
                {isExcel ? "Excel 文件" : "参考资料"}
              </div>
              <div
                className="mt-2 text-xs"
                style={{ color: "var(--oc-text-tertiary)" }}
              >
                {isExcel
                  ? "支持 .xlsx/.xls。后续会解析工作簿并生成填表计划。"
                  : "支持文档、图片、网页资料和参考 PPT。后续先生成大纲预览。"}
              </div>
              <button
                type="button"
                disabled
                className="mt-3 rounded-md px-3 py-2 text-sm"
                style={{
                  background: "var(--oc-bg-surface)",
                  border: "1px solid var(--oc-border)",
                  color: "var(--oc-text-tertiary)",
                }}
              >
                上传文件（待接入）
              </button>
            </div>
            <textarea
              rows={4}
              disabled
              placeholder={
                isExcel
                  ? "例如：根据客户资料补全空白字段，不覆盖已有内容。"
                  : "例如：生成 8 页客户汇报 PPT，风格商务简洁。"
              }
              className="rounded-md px-3 py-2 text-sm resize-none"
              style={{
                background: "var(--oc-panel)",
                border: "1px solid var(--oc-border)",
                color: "var(--oc-text-primary)",
              }}
            />
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <h3 className="text-sm font-semibold">预览</h3>
          <div
            className="mt-4 rounded-md p-4 text-sm leading-7"
            style={{
              background: "var(--oc-panel)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-secondary)",
            }}
          >
            {isExcel ? (
              <>
                <div
                  className="font-medium"
                  style={{ color: "var(--oc-text-primary)" }}
                >
                  填表计划预览
                </div>
                <div className="mt-2">Sheet1!B4：空 -&gt; 建议填写内容</div>
                <div>理由：来自用户背景资料</div>
                <div>置信度：0.85</div>
              </>
            ) : (
              <>
                <div
                  className="font-medium"
                  style={{ color: "var(--oc-text-primary)" }}
                >
                  PPT 大纲预览
                </div>
                <div className="mt-2">第 1 页：标题页</div>
                <div>第 2 页：背景与问题</div>
                <div>第 3 页：解决方案</div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function OfficeSpacePage({ adoptId }: OfficeSpacePageProps) {
  const [selected, setSelected] = useState<CapabilityId | null>(null);

  if (selected === "meeting-notes") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        initialTemplateId="meeting_notes"
        templateIds={workbenchTemplateIds}
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "excel-fill") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        initialTemplateId="excel_fill"
        templateIds={workbenchTemplateIds}
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "ppt-create") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        templateIds={workbenchTemplateIds}
        initialTemplateId="research_ppt"
        titleLabel="办公空间"
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "video-outline") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        initialTemplateId="video_outline"
        templateIds={workbenchTemplateIds}
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "market-research-brief") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        templateIds={workbenchTemplateIds}
        initialTemplateId="market_research_brief"
        titleLabel="办公空间"
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "meeting-prep-agent") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        templateIds={workbenchTemplateIds}
        initialTemplateId="meeting_prep_agent"
        titleLabel="办公空间"
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  if (selected === "wind-announcement-digest") {
    return (
      <DocumentTaskWorkbench
        adoptId={adoptId}
        apiBase="/api/claw/office/task-workbench"
        templateIds={workbenchTemplateIds}
        initialTemplateId="wind_announcement_digest"
        titleLabel="办公空间"
        showSelector={false}
        compactOfficeMode
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <main
      className="h-full min-h-0 overflow-y-auto stealth-scrollbar"
      style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}
    >
      <div className="mx-auto max-w-6xl px-5 py-5 space-y-4">
        <section>
          <h3
            className="mb-3 text-xs font-semibold"
            style={{ color: "var(--oc-text-secondary)" }}
          >
            通用办公
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {generalCapabilities.map(capability => (
              <CapabilityCard
                key={capability.id}
                capability={capability}
                onClick={() => setSelected(capability.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <h3
            className="mb-3 text-xs font-semibold"
            style={{ color: "var(--oc-text-secondary)" }}
          >
            金融专业
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {financeCapabilities.map(capability => (
              <CapabilityCard
                key={capability.id}
                capability={capability}
                onClick={() => setSelected(capability.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
