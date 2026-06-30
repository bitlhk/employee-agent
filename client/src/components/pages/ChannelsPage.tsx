import { useState } from "react";
import type { ReactNode } from "react";
import { Bell, CheckCircle2, MessageCircle, QrCode, Send, ShieldOff, Unlink } from "lucide-react";
import { PageContainer } from "@/components/console/PageContainer";
import { useChannelBinding } from "@/hooks/useChannelBinding";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type ChannelKey = "feishu" | "dingtalk" | "wechat" | "wecom";

const CHANNELS: Array<{
  key: ChannelKey;
  label: string;
  desc: string;
  iconSrc?: string;
  status: "ready" | "jiuwen-ready" | "unsupported";
}> = [
  { key: "feishu", label: "飞书", desc: "JiuwenSwarm 支持，已接入扫码授权和任务推送", iconSrc: "/channel-icons/feishu.webp", status: "ready" },
  { key: "dingtalk", label: "钉钉", desc: "JiuwenSwarm 支持，EA 绑定接入中", iconSrc: "/channel-icons/dingtalk.png", status: "jiuwen-ready" },
  { key: "wechat", label: "微信", desc: "等待 JiuwenSwarm 频道支持后适配", iconSrc: "/channel-icons/wechat.png", status: "unsupported" },
  { key: "wecom", label: "企业微信", desc: "等待 JiuwenSwarm 频道支持后适配", iconSrc: "/channel-icons/wecom.webp", status: "unsupported" },
];

export function ChannelsPage({ adoptId }: { adoptId?: string }) {
  const [active, setActive] = useState<ChannelKey>("feishu");
  const feishu = useChannelBinding("feishu", adoptId);
  const { confirm, dialog } = useConfirmDialog();

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
            const binding = channel.key === "feishu" ? feishu : null;
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
            <ScanChannelDetail
              channelLabel="飞书"
              connectedTitle="飞书已连接"
              connectedDesc="定时任务和协作提醒现在可以投递到飞书。飞书内直接发消息给员工智能体的双向对话会在后续版本继续增强。"
              idleTitle={feishu.status === "loading" ? "正在获取授权二维码..." : "扫码连接飞书"}
              idleDesc="飞书是当前 EA 面向 JiuwenSwarm 的优先频道，采用扫码授权，支持任务通知推送。"
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
              bullets={["JiuwenSwarm 支持", "支持任务完成通知", "扫码授权免 webhook 配置"]}
            />
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
