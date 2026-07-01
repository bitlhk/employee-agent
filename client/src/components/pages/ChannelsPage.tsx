import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, MessageCircle, ShieldOff, Unlink } from "lucide-react";
import { PageContainer } from "@/components/console/PageContainer";

type ChannelKey = "feishu" | "dingtalk" | "wechat" | "wecom";

const CHANNELS: Array<{
  key: ChannelKey;
  label: string;
  desc: string;
  iconSrc?: string;
  status: "ready" | "jiuwen-ready" | "unsupported";
}> = [
  { key: "feishu", label: "飞书", desc: "通过灵感智能体应用绑定当前员工智能体", iconSrc: "/channel-icons/feishu.webp", status: "ready" },
  { key: "dingtalk", label: "钉钉", desc: "JiuwenSwarm 支持，EA 绑定接入中", iconSrc: "/channel-icons/dingtalk.png", status: "jiuwen-ready" },
  { key: "wechat", label: "微信", desc: "等待 JiuwenSwarm 频道支持后适配", iconSrc: "/channel-icons/wechat.png", status: "unsupported" },
  { key: "wecom", label: "企业微信", desc: "等待 JiuwenSwarm 频道支持后适配", iconSrc: "/channel-icons/wecom.webp", status: "unsupported" },
];

export function ChannelsPage({ adoptId }: { adoptId?: string }) {
  const [active, setActive] = useState<ChannelKey>("feishu");
  const [feishuBridgeBound, setFeishuBridgeBound] = useState(false);

  const refreshFeishuBridge = async () => {
    if (!adoptId) {
      setFeishuBridgeBound(false);
      return;
    }
    try {
      const r = await fetch(`/api/claw/feishu/bidirectional/status?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      setFeishuBridgeBound(!!d.bound);
    } catch {
      setFeishuBridgeBound(false);
    }
  };

  useEffect(() => {
    void refreshFeishuBridge();
  }, [adoptId]);

  return (
    <PageContainer title="频道" desc="管理员工智能体与你的触达方式。日常对话、协作提醒和定时任务都可以复用这些频道。">
      <div className="channel-layout">
        <aside className="settings-card channel-list" aria-label="频道列表">
          {CHANNELS.map((channel) => {
            const activeChannel = active === channel.key;
            const bound = channel.key === "feishu" ? feishuBridgeBound : false;
            return (
              <button
                key={channel.key}
                className="channel-list__item"
                data-active={activeChannel}
                aria-current={activeChannel ? "true" : undefined}
                type="button"
                onClick={() => setActive(channel.key)}
              >
                <span className="channel-brand" aria-hidden="true">
                  {channel.iconSrc ? <img src={channel.iconSrc} alt="" /> : <span>{channel.label.slice(0, 1)}</span>}
                </span>
                <span className="channel-list__copy">
                  <span className="channel-list__title">
                    {channel.label}
                    {bound ? <span className="channel-pill channel-pill--ok">已绑定</span> : null}
                    {!bound && channel.status === "ready" ? <span className="channel-pill channel-pill--info">未绑定</span> : null}
                    {!bound && channel.status === "jiuwen-ready" ? <span className="channel-pill channel-pill--info">未绑定</span> : null}
                    {channel.status === "unsupported" ? <span className="channel-pill">适配中</span> : null}
                  </span>
                  <span className="channel-list__desc">{channel.desc}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="settings-card channel-detail">
          {active === "feishu" ? (
            <FeishuBridgePanel adoptId={adoptId} onStatusChange={setFeishuBridgeBound} />
          ) : active === "dingtalk" ? (
            <ComingSoonDetail
              icon={<MessageCircle size={22} />}
              title="钉钉频道接入中"
              desc="JiuwenSwarm 原生支持钉钉频道，EA 侧还需要补齐绑定、测试发送和任务投递配置。"
              points={["JiuwenSwarm 支持钉钉", "EA 绑定页面尚未接入", "接入完成后可作为任务通知频道"]}
              buttonText="接入中"
            />
          ) : (
            <UnsupportedChannelDetail channelLabel={active === "wechat" ? "微信" : "企业微信"} />
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function FeishuBridgePanel({
  adoptId,
  onStatusChange,
}: {
  adoptId?: string;
  onStatusChange?: (bound: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [bound, setBound] = useState(false);
  const [targetLabel, setTargetLabel] = useState("");
  const [code, setCode] = useState("");
  const [instruction, setInstruction] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const refresh = async () => {
    if (!adoptId) return;
    try {
      const r = await fetch(`/api/claw/feishu/bidirectional/status?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      setBound(!!d.bound);
      onStatusChange?.(!!d.bound);
      setTargetLabel(String(d.targetLabel || ""));
    } catch {
      setBound(false);
      onStatusChange?.(false);
      setTargetLabel("");
    }
  };

  useEffect(() => {
    void refresh();
  }, [adoptId]);

  useEffect(() => {
    if (!adoptId || !code || bound) return;
    const timer = setInterval(() => { void refresh(); }, 2500);
    return () => clearInterval(timer);
  }, [adoptId, code, bound]);

  const begin = async () => {
    if (!adoptId) return;
    setLoading(true);
    try {
      const r = await fetch("/api/claw/feishu/bidirectional/begin", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || "begin failed");
      setCode(String(d.code || ""));
      setInstruction(String(d.instruction || ""));
      setExpiresAt(String(d.expiresAt || ""));
      setBound(false);
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const unbind = async () => {
    if (!adoptId) return;
    setLoading(true);
    try {
      await fetch("/api/claw/feishu/bidirectional/unbind", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId }),
      });
      setBound(false);
      onStatusChange?.(false);
      setTargetLabel("");
      setCode("");
      setInstruction("");
      setExpiresAt("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="channel-detail__body">
      <div className={bound ? "channel-status-icon channel-status-icon--ok" : "channel-status-icon"}>
        <MessageCircle size={26} />
      </div>
      <h2 className="channel-detail__title">飞书绑定</h2>
      <p className="channel-detail__desc">
        将飞书账号绑定到当前员工智能体后，可以在飞书里直接对话，后续也可复用到定时任务和协作提醒。
      </p>
      <div className="channel-bullets">
        <span><CheckCircle2 size={14} /> 联系灵感大王加入企业组织</span>
        <span><CheckCircle2 size={14} /> 在飞书中添加灵感智能体应用</span>
        <span><CheckCircle2 size={14} /> 点击按钮获取绑定码，并在智能体私聊中输入完成绑定</span>
      </div>
      {bound ? (
        <div className="channel-meta">
          <span>绑定状态</span>
          <strong>{targetLabel ? `已绑定 ${targetLabel}` : "已绑定飞书双向交互"}</strong>
        </div>
      ) : null}
      {code && !bound ? (
        <div className="channel-bind-code">
          <span>{code}</span>
          <p>{instruction || `请在飞书 Bot 私聊发送：绑定 ${code}`}</p>
          {expiresAt ? <small>有效期至 {new Date(expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small> : null}
        </div>
      ) : null}
      <div className="channel-actions">
        {bound ? (
          <button className="skills-btn" onClick={unbind} disabled={loading}>
            <Unlink size={14} /> 解绑双向
          </button>
        ) : (
          <button className="page-primary-action" onClick={begin} disabled={loading || !adoptId}>
            <MessageCircle size={14} /> {loading ? "生成中..." : "获取绑定码"}
          </button>
        )}
        {!bound && code ? (
          <button className="skills-btn" onClick={() => void refresh()} disabled={loading}>
            检查状态
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ComingSoonDetail({
  icon,
  title,
  desc,
  points,
  buttonText = "即将上线",
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  points: string[];
  buttonText?: string;
}) {
  return (
    <div className="channel-detail__body">
      <div className="channel-status-icon channel-status-icon--muted">{icon}</div>
      <h2 className="channel-detail__title">{title}</h2>
      <p className="channel-detail__desc">{desc}</p>
      <div className="channel-bullets">
        {points.map((point) => (
          <span key={point}><CheckCircle2 size={14} /> {point}</span>
        ))}
      </div>
      <button className="skills-btn" disabled>
        {buttonText}
      </button>
    </div>
  );
}

function UnsupportedChannelDetail({ channelLabel }: { channelLabel: string }) {
  return (
    <div className="channel-detail__body">
      <div className="channel-status-icon channel-status-icon--muted"><ShieldOff size={26} /></div>
      <h2 className="channel-detail__title">{channelLabel}适配中</h2>
      <p className="channel-detail__desc">
        当前 EA 按 JiuwenSwarm 频道能力接入。{channelLabel}会等 JiuwenSwarm 侧提供稳定频道能力后再适配，暂时不开放绑定入口。
      </p>
      <div className="channel-bullets">
        <span><ShieldOff size={14} /> 暂不展示绑定入口</span>
        <span><CheckCircle2 size={14} /> 暂不作为定时任务渠道</span>
        <span><MessageCircle size={14} /> 待 JiuwenSwarm 支持后接入</span>
      </div>
      <button className="skills-btn" disabled>
        适配中
      </button>
    </div>
  );
}
