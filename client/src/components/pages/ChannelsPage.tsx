import { useState } from "react";
import type { ReactNode } from "react";
import { Bell, Building2, CheckCircle2, MessageCircle, QrCode, Send, Unlink } from "lucide-react";
import { PageContainer } from "@/components/console/PageContainer";
import { useChannelBinding } from "@/hooks/useChannelBinding";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type ChannelKey = "wechat" | "feishu" | "wecom";

const CHANNELS: Array<{
  key: ChannelKey;
  label: string;
  desc: string;
  iconSrc: string;
  status: "ready" | "notify-ready" | "soon";
}> = [
  { key: "wechat", label: "微信", desc: "个人微信扫码绑定，支持对话与任务通知", iconSrc: "/channel-icons/wechat.png", status: "ready" },
  { key: "feishu", label: "飞书", desc: "扫码授权，支持任务结果推送", iconSrc: "/channel-icons/feishu.webp", status: "notify-ready" },
  { key: "wecom", label: "企业微信", desc: "管理员配置，面向企业内部触达", iconSrc: "/channel-icons/wecom.webp", status: "soon" },
];

export function ChannelsPage({ adoptId }: { adoptId?: string }) {
  const [active, setActive] = useState<ChannelKey>("wechat");
  const wechat = useChannelBinding("wechat", adoptId);
  const feishu = useChannelBinding("feishu", adoptId);
  const { confirm, dialog } = useConfirmDialog();

  const unbindWechat = async () => {
    const ok = await confirm({
      title: "解绑微信？",
      description: "解绑后将无法通过微信接收通知和对话。",
      confirmText: "解绑",
      variant: "danger",
    });
    if (!ok) return;
    await wechat.unbind();
  };

  const unbindFeishu = async () => {
    const ok = await confirm({
      title: "解绑飞书？",
      description: "解绑后将无法通过飞书接收通知。",
      confirmText: "解绑",
      variant: "danger",
    });
    if (!ok) return;
    await feishu.unbind();
  };

  return (
    <PageContainer title="频道" desc="管理员工智能体与你的触达方式。日常对话、协作提醒和定时任务都可以复用这些频道。">
      {dialog}
      <div className="channel-layout">
        <aside className="settings-card channel-list" aria-label="频道列表">
          {CHANNELS.map((channel) => {
            const activeChannel = active === channel.key;
            const binding = channel.key === "wechat" ? wechat : channel.key === "feishu" ? feishu : null;
            const bound = binding?.status === "bound";
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
                  <img src={channel.iconSrc} alt="" />
                </span>
                <span className="channel-list__copy">
                  <span className="channel-list__title">
                    {channel.label}
                    {bound ? <span className="channel-pill channel-pill--ok">已绑定</span> : null}
                    {!bound && channel.status === "ready" ? <span className="channel-pill channel-pill--info">未绑定</span> : null}
                    {!bound && channel.status === "notify-ready" ? <span className="channel-pill channel-pill--info">可推送</span> : null}
                    {!bound && channel.status === "soon" ? <span className="channel-pill">即将上线</span> : null}
                  </span>
                  <span className="channel-list__desc">{channel.desc}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="settings-card channel-detail">
          {active === "wechat" ? (
            <ScanChannelDetail
              channelLabel="微信"
              connectedTitle="微信已连接"
              connectedDesc="你可以直接在微信里和员工智能体对话，也可以接收协作提醒和定时任务结果。"
              idleTitle={wechat.status === "loading" ? "正在获取二维码..." : "连接你的微信"}
              idleDesc="绑定后，微信既可以作为对话入口，也可以作为定时任务和协作提醒的投递频道。"
              scanTitle="请用微信扫描二维码"
              scanDesc="扫码后在微信里确认授权，绑定成功后本页会自动刷新。"
              status={wechat.status}
              qrcodeUrl={wechat.qrCode || ""}
              targetLabel={wechat.targetLabel || ""}
              testing={wechat.testing}
              onStartBind={wechat.startBind}
              onTest={wechat.test}
              onUnbind={unbindWechat}
              bullets={["定时任务完成后可推送到微信", "支持日常对话入口", "已接入当前生产通知链路"]}
            />
          ) : active === "feishu" ? (
            <ScanChannelDetail
              channelLabel="飞书"
              connectedTitle="飞书已连接"
              connectedDesc="定时任务和协作提醒现在可以投递到飞书。飞书内直接发消息给员工智能体的双向对话会在后续版本继续增强。"
              idleTitle={feishu.status === "loading" ? "正在获取授权二维码..." : "扫码连接飞书"}
              idleDesc="飞书采用扫码授权，不需要普通用户手动配置 webhook。当前已支持任务通知推送，飞书内主动发消息给员工智能体暂未开放。"
              scanTitle="请用飞书扫描二维码"
              scanDesc="扫码授权后，员工智能体会自动保存飞书应用凭证用于任务通知。"
              status={feishu.status}
              qrcodeUrl={feishu.qrCode || ""}
              verificationUri={feishu.verificationUri}
              userCode={feishu.userCode}
              targetLabel={feishu.targetLabel || ""}
              testing={feishu.testing}
              onStartBind={feishu.startBind}
              onTest={feishu.test}
              onUnbind={unbindFeishu}
              bullets={["支持任务完成通知", "扫码授权免 webhook 配置", "飞书内主动对话后续开放"]}
            />
          ) : (
            <ComingSoonDetail
              icon={<Building2 size={22} />}
              title="企业微信管理员配置"
              desc="企业微信适合组织级部署，会走管理员配置和企业凭证托管。"
              points={["适合银行内部办公 IM", "后续支持 corpId / agentId / secret 托管", "普通用户无需直接接触复杂凭证"]}
            />
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function ScanChannelDetail({
  channelLabel,
  connectedTitle,
  connectedDesc,
  idleTitle,
  idleDesc,
  scanTitle,
  scanDesc,
  status,
  qrcodeUrl,
  verificationUri,
  userCode,
  targetLabel,
  testing,
  onStartBind,
  onTest,
  onUnbind,
  bullets,
}: {
  channelLabel: string;
  connectedTitle: string;
  connectedDesc: string;
  idleTitle: string;
  idleDesc: string;
  scanTitle: string;
  scanDesc: string;
  status: "idle" | "loading" | "scanning" | "bound" | "unsupported";
  qrcodeUrl: string;
  verificationUri?: string;
  userCode?: string;
  targetLabel: string;
  testing: boolean;
  onStartBind: () => void;
  onTest: () => void;
  onUnbind: () => void;
  bullets: string[];
}) {
  if (status === "bound") {
    return (
      <div className="channel-detail__body">
        <div className="channel-status-icon channel-status-icon--ok"><CheckCircle2 size={26} /></div>
        <h2 className="channel-detail__title">{connectedTitle}</h2>
        <p className="channel-detail__desc">{connectedDesc}</p>
        <div className="channel-meta">
          <span>绑定身份</span>
          <strong>{targetLabel || "已绑定"}</strong>
        </div>
        <div className="channel-actions">
          <button className="btn-primary-soft" onClick={onTest} disabled={testing}>
            <Send size={14} /> {testing ? "发送中..." : "测试发送"}
          </button>
          <button className="skills-btn" onClick={onUnbind}>
            <Unlink size={14} /> 解绑
          </button>
        </div>
      </div>
    );
  }

  if (status === "scanning") {
    return (
      <div className="channel-detail__body">
        <div className="channel-status-icon"><QrCode size={26} /></div>
        <h2 className="channel-detail__title">{scanTitle}</h2>
        <p className="channel-detail__desc">{scanDesc}</p>
        {qrcodeUrl ? (
          <img
            className="channel-qr"
            src={"https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(qrcodeUrl)}
            alt={`${channelLabel}绑定二维码`}
          />
        ) : null}
        {verificationUri ? (
          <div className="channel-meta">
            <span>无法扫码？</span>
            <strong>
              <a href={verificationUri} target="_blank" rel="noreferrer">打开授权页</a>
              {userCode ? ` · 输入 ${userCode}` : ""}
            </strong>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="channel-detail__body">
      <div className="channel-status-icon"><MessageCircle size={26} /></div>
      <h2 className="channel-detail__title">{idleTitle}</h2>
      <p className="channel-detail__desc">{idleDesc}</p>
      <div className="channel-bullets">
        {bullets.map((bullet, idx) => {
          const Icon = idx === 0 ? Bell : idx === 1 ? MessageCircle : CheckCircle2;
          return <span key={bullet}><Icon size={14} /> {bullet}</span>;
        })}
      </div>
      <button className="page-primary-action" onClick={onStartBind} disabled={status === "loading"}>
        <QrCode size={14} /> {status === "loading" ? "获取中..." : `扫码绑定${channelLabel}`}
      </button>
    </div>
  );
}

function ComingSoonDetail({
  icon,
  title,
  desc,
  points,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  points: string[];
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
        即将上线
      </button>
    </div>
  );
}
