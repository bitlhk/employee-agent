/**
 * CoopSession — 灵虾组织协作窗口
 * URL: /coop/:sessionId
 * 
 * 视角：
 *   creator  — 发起人；看所有成员状态
 *   member   — 被邀请人；在 pending 状态时能同意/拒绝/修改子任务
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowLeft, CheckCircle2, Users as UsersIcon, Paperclip, Download } from "lucide-react";
import { toast } from "sonner";
import { CoopChatBox } from "@/components/CoopChatBox";
import { memberStatusMeta, sessionStatusMeta } from "@/lib/coopStatus";

type EventAttachment = { name: string; url: string; source?: string; size?: number };

function formatAttSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function formatMemberOrg(member: any): string {
  const parts = [member.targetOrgName, member.targetDepartmentName, member.targetTeamName].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  if (member.targetGroupName && member.targetGroupId > 0) return `— · ${member.targetGroupName}`;
  return "—";
}

function AttachmentList({ attachments }: { attachments: EventAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium mb-1 flex items-center gap-1" style={{ color: "var(--oc-text-secondary, #64748b)" }}>
        <Paperclip className="w-3 h-3" /> 附件 ({attachments.length})
      </div>
      <div className="space-y-1">
        {attachments.map((f, i) => (
          <a
            key={`${f.url}-${i}`}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-xs text-primary hover:bg-primary/10"
            style={{
              background: "color-mix(in oklab, var(--oc-accent) 6%, transparent)",
              border: "1px solid color-mix(in oklab, var(--oc-accent) 20%, transparent)",
              textDecoration: "none",
            }}
            title={`下载 ${f.name}`}
          >
            <Download className="w-3 h-3 shrink-0" />
            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
            {f.size ? <span className="text-[10px] opacity-70 shrink-0">{formatAttSize(f.size)}</span> : null}
          </a>
        ))}
      </div>
    </div>
  );
}

// 状态 meta 统一走 lib/coopStatus，避免各文件重复定义。

export default function CoopSession() {
  const [, params] = useRoute("/coop/:sessionId");
  const [, setLocation] = useLocation();
  const sessionId = params?.sessionId || "";

  // 拉 session 详情（每 3 秒 refetch 一次作为轮询）
  const { data, isLoading, error, refetch } = trpc.coop.getSession.useQuery(
    { sessionId },
    { enabled: Boolean(sessionId), refetchInterval: 3000 }
  );

  const agreeMut = trpc.coop.agree.useMutation({
    onSuccess: () => { toast.success("已同意"); refetch(); },
    onError: (e) => toast.error(e.message || "同意失败"),
  });
  const rejectMut = trpc.coop.reject.useMutation({
    onSuccess: () => { toast.success("已拒绝"); refetch(); },
    onError: (e) => toast.error(e.message || "拒绝失败"),
  });

  // 拿当前用户的 adoptId，返回时跳 /claw/{adoptId}（即"我的虾"主页 + 协作 tab）
  // 注意：App.tsx 里 / 是 <ClawHome /> 领养页，/claw/:adoptId 才是 <Home /> 含「我的协作」
  const { data: myClawForBack } = trpc.claw.me.useQuery(undefined, { retry: false });
  const myAdoptIdForBack = (myClawForBack as any)?.adoption?.adoptId as string | undefined;

  // 拉 events 用于解析每个已提交成员的附件列表（来自 member_completed event payload.attachments）
  const eventsQ = trpc.coop.listEvents.useQuery(
    { sessionId, sinceId: 0, limit: 200 },
    { enabled: Boolean(sessionId), refetchInterval: 5000 }
  );
  // 按 requestId 索引附件列表
  const attachmentsByRequestId = useMemo(() => {
    const map = new Map<number, EventAttachment[]>();
    const events = (eventsQ.data?.events as any[]) || [];
    for (const ev of events) {
      if (ev.eventType !== "member_completed") continue;
      if (!ev.requestId) continue;
      let payload: any = ev.payload;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { payload = null; }
      }
      const atts = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (atts.length > 0) map.set(Number(ev.requestId), atts);
    }
    return map;
  }, [eventsQ.data]);

  if (!sessionId) {
    return <div className="p-8 text-center text-foreground">无效的 session ID</div>;
  }
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-medium text-destructive mb-2">加载失败</div>
        <div className="text-sm text-foreground mb-4">{error?.message || "协作不存在或无权访问"}</div>
        <Button variant="outline" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> 返回首页
        </Button>
      </div>
    );
  }

  const { session, members, viewerRole } = data;
  const currentUserId = (data as any).viewerUserId as number | undefined;
  const isMember = Boolean((data as any).viewerIsMember);
  const isCreator = Boolean((data as any).viewerIsCreator);
  const sessionStatus = sessionStatusMeta(session.status);

  return (
    <div className="min-h-screen coop-session-themed">
      {/* 顶部 Header */}
      <div className="sticky top-0 z-10 bg-card/80 backdrop-blur border-b border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-foreground" onClick={() => {
            // 显式回「我的协作」tab：写 sessionStorage 让 Home 初始化时落地 collab 页
            // 跳 /claw/{adoptId}（Home），不是 / （那是 ClawHome 领养首页）
            try { sessionStorage.setItem("home_initial_page", "collab"); } catch {}
            if (myAdoptIdForBack) {
              setLocation(`/claw/${myAdoptIdForBack}`);
            } else {
              setLocation("/"); // fallback：没领养就回 ClawHome
            }
          }}>
            <ArrowLeft className="w-4 h-4 mr-1" /> 返回
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <UsersIcon className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">{session.title || "协作任务"}</h1>
              <span className={`badge ${sessionStatus.badgeClass}`}>{sessionStatus.label}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              协作 ID: <span className="font-mono">{session.id}</span> · {members.length} 位成员 · {isCreator && isMember ? "你是发起人（含成员）" : isCreator ? "你是发起人" : "你是协作成员"}
            </div>
          </div>
        </div>
      </div>

      {/* 原始消息 */}
      {session.originMessage && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <Card className="p-4 bg-card/80 border-border/50">
            <div className="text-xs font-medium text-muted-foreground mb-2">发起任务</div>
            <div className="text-sm text-foreground whitespace-pre-wrap">{session.originMessage}</div>
          </Card>
        </div>
      )}

      {/* 成员卡片 —— 接收方自己的卡片占整行宽度（因要内嵌 ChatBox），其他成员正常 grid */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* 我的卡片（占整行，底部可展开 ChatBox） */}
        {(() => {
          const myCard = members.find((m: any) => m.targetUserId === currentUserId);
          if (!myCard) return null;
          const meta = memberStatusMeta(myCard.status);
          const Icon = meta.icon;
          // running / approved 都算"已接手"：可以展开 ChatBox 继续干活
          const showChatBox = ["approved", "running"].includes(myCard.status);
          return (
            <Card className="p-4 bg-primary/5 border-primary/20 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">
                    {myCard.targetUserName || myCard.targetEmail || `#${myCard.targetUserId}`}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-normal">我</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatMemberOrg(myCard)}
                  </div>
                </div>
                <span className={`badge ${meta.badgeClass} inline-flex items-center gap-1 shrink-0`}>
                  <Icon className="w-3 h-3" /> {meta.label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mb-1">分配给我的子任务</div>
              <div className="text-sm text-foreground bg-muted/50 rounded p-2 mb-3">{myCard.taskSummary || "—"}</div>
              {/* pending → 接手 / 修改 / 拒绝 */}
              {myCard.status === "pending" ? (
                <InvitationActions
                  requestId={myCard.requestId}
                  originalSubtask={myCard.taskSummary || ""}
                  onAgree={(modified) => agreeMut.mutate({ requestId: myCard.requestId, modifiedSubtask: modified })}
                  onReject={(reason) => rejectMut.mutate({ requestId: myCard.requestId, reason })}
                  busy={agreeMut.isPending || rejectMut.isPending}
                />
              ) : null}
              {/* 接手后（approved/running）→ 内嵌 CoopChatBox */}
              {showChatBox ? (
                <CoopChatBox
                  sessionId={sessionId}
                  requestId={myCard.requestId}
                  subtask={myCard.taskSummary || ""}
                  coopTitle={session.title || "协作任务"}
                  onSubmitted={() => refetch()}
                />
              ) : null}
              {/* 已提交 */}
              {myCard.status === "completed" && myCard.resultSummary ? (
                <>
                  <div
                    className="mt-2 text-xs text-foreground rounded p-2 whitespace-pre-wrap"
                    style={{
                      background: "color-mix(in oklab, var(--oc-success) 10%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--oc-success) 25%, transparent)",
                      maxHeight: 240, overflowY: "auto", overflowWrap: "anywhere",
                    }}
                  >
                    {myCard.resultSummary}
                  </div>
                  <AttachmentList attachments={attachmentsByRequestId.get(myCard.requestId) || []} />
                </>
              ) : null}
            </Card>
          );
        })()}

        {/* 其他成员卡片（不含我，3 列 grid） */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.filter((m: any) => m.targetUserId !== currentUserId).map((m) => {
            const meta = memberStatusMeta(m.status);
            const Icon = meta.icon;
            return (
              <Card key={m.requestId} className="p-4 bg-card border-border/50 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{m.targetUserName || m.targetEmail || `#${m.targetUserId}`}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatMemberOrg(m)}
                    </div>
                  </div>
                  <span className={`badge ${meta.badgeClass} inline-flex items-center gap-1 shrink-0`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-1">子任务</div>
                <div className="text-sm text-foreground bg-muted/50 rounded p-2 mb-3">{m.taskSummary || "—"}</div>
                {/* 完成后的结果 */}
                {m.status === "completed" && m.resultSummary ? (
                  <>
                    <div
                      className="mt-2 text-xs text-foreground rounded p-2 whitespace-pre-wrap"
                      style={{
                        background: "color-mix(in oklab, var(--oc-success) 10%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--oc-success) 25%, transparent)",
                        maxHeight: 240, overflowY: "auto", overflowWrap: "anywhere",
                      }}
                    >
                      {m.resultSummary}
                    </div>
                    <AttachmentList attachments={attachmentsByRequestId.get(m.requestId) || []} />
                  </>
                ) : null}
              </Card>
            );
          })}
        </div>

        {/* ── 已发布的最终结果（所有 member 都能看，发起人也能看）── */}
        {session.status === "published" && session.finalSummary ? (
          <Card
            className="mt-6 p-5"
            style={{
              background: "color-mix(in oklab, var(--oc-success) 8%, transparent)",
              borderColor: "color-mix(in oklab, var(--oc-success) 30%, transparent)",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4" style={{ color: "var(--oc-success)" }} />
              <div className="text-sm font-semibold text-foreground">📢 协作最终汇总（已发布）</div>
              {(session as any).publishedAt ? (
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {new Date((session as any).publishedAt).toLocaleString("zh-CN", { hour12: false })}
                </span>
              ) : null}
            </div>
            <div
              className="text-sm text-foreground whitespace-pre-wrap rounded p-3 bg-card"
              style={{
                border: "1px solid color-mix(in oklab, var(--oc-success) 30%, transparent)",
                maxHeight: 480,
                overflowY: "auto",
                overflowWrap: "anywhere",
              }}
            >
              {session.finalSummary}
            </div>
            {/* 发布者信息 */}
            <div className="mt-2 text-[11px] text-muted-foreground">
              发布人：{isCreator ? "我（发起人）" : `#${session.creatorUserId}`}
            </div>
          </Card>
        ) : null}

        {/* ── Step 5: 发起人汇总/发布面板（仅发起人能编辑/发布/解散）── */}
        {isCreator ? <ConsolidationPanel sessionId={sessionId} session={session} members={members} onRefresh={refetch} /> : null}
      </div>
    </div>
  );
}

// ── 发起人整合/发布面板 ──
function ConsolidationPanel({ sessionId, session, members, onRefresh }: {
  sessionId: string;
  session: any;
  members: any[];
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState<string>(session.finalSummary || "");
  const [providerUsed, setProviderUsed] = useState<string>("");
  const [hasDraft, setHasDraft] = useState(Boolean(session.finalSummary));
  // 优先读发起时从模板写入的汇总预设；没有则空串（走默认 SYSTEM_PROMPT）
  const [customInstructions, setCustomInstructions] = useState<string>(session.consolidationPromptPreset || "");
  const hasPreset = Boolean(session.consolidationPromptPreset);

  const consolidateMut = trpc.coop.consolidate.useMutation({
    onSuccess: (r) => {
      setDraft(r.draft);
      setProviderUsed(r.providerUsed);
      setHasDraft(true);
      toast.success(`AI 汇总完成（${r.providerUsed}）`);
    },
    onError: (e) => toast.error(e.message || "汇总失败"),
  });
  const publishMut = trpc.coop.publish.useMutation({
    onSuccess: () => { toast.success("已发布，全员可见"); onRefresh(); },
    onError: (e) => toast.error(e.message || "发布失败"),
  });
  const closeMut = trpc.coop.close.useMutation({
    onSuccess: (r) => { toast.success(r.nextStatus === "dissolved" ? "已解散" : "已关闭"); onRefresh(); },
    onError: (e) => toast.error(e.message || "关闭失败"),
  });

  const TERMINAL = new Set(["completed", "rejected", "failed", "cancelled"]);
  const allTerminal = members.every((m: any) => TERMINAL.has(m.status));
  const anyCompleted = members.some((m: any) => m.status === "completed");
  const readyToConsolidate = allTerminal && anyCompleted;
  const isPublished = session.status === "published";
  const isClosed = session.status === "closed" || session.status === "dissolved";

  return (
    <Card className="mt-6 p-5 bg-card border-border/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-foreground">汇总 · 发布</div>
          <div className="text-xs text-foreground mt-0.5">
            {isPublished ? "✅ 已发布，全员可见" : isClosed ? "协作已关闭" : readyToConsolidate ? "成员全部完成，可以汇总" : "等待成员完成执行..."}
          </div>
        </div>
        <div className="flex gap-2">
          {!isClosed ? (
            <Button size="sm" variant="ghost" className="text-foreground" onClick={() => {
              const mode = window.confirm("解散群组？（确定=解散，取消=只关闭保留）") ? "dissolve" : "keep";
              closeMut.mutate({ sessionId, mode });
            }} disabled={closeMut.isPending}>
              关闭/解散
            </Button>
          ) : null}
        </div>
      </div>

      {/* 2026-04-17: 自定义汇总指令（发起人可填，未填走默认 prompt） */}
      {!isPublished && !isClosed && readyToConsolidate ? (
        <div className="mt-2 mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">
            自定义汇总指令{hasPreset ? "（已从发起模板预填 · 可修改）" : "（可选 · 留空走默认）"}
          </label>
          <Textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="例如：按部门分组列出 / 重点突出风险项 / 限 500 字内 / 大行公文严肃风格 / 用表格呈现 ..."
            className="text-sm min-h-[60px]"
            disabled={consolidateMut.isPending}
            maxLength={1000}
          />
          <div className="flex items-center justify-between mt-1.5">
            <div className="text-[10px] text-muted-foreground">{customInstructions.length}/1000</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => consolidateMut.mutate({
                sessionId,
                customInstructions: customInstructions.trim() || undefined,
              })}
              disabled={consolidateMut.isPending}
            >
              {consolidateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              ✨ AI 汇总{hasDraft ? "（重新生成）" : ""}
            </Button>
          </div>
        </div>
      ) : null}
      {(hasDraft || isPublished) ? (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[220px] text-sm font-mono"
            placeholder="汇总内容（可编辑后发布）"
            readOnly={isPublished}
          />
          {providerUsed ? <div className="text-[11px] text-muted-foreground mt-1">模型：{providerUsed}</div> : null}
          {!isPublished && !isClosed ? (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                className="text-white"
                style={{ background: "var(--oc-success)" }}
                onClick={() => publishMut.mutate({ sessionId, finalSummary: draft })}
                disabled={publishMut.isPending || !draft.trim()}
              >
                {publishMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                发布给所有成员
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

// ── 被邀请者同意/拒绝 UI ──
function InvitationActions({ requestId, originalSubtask, onAgree, onReject, busy }: {
  requestId: number;
  originalSubtask: string;
  onAgree: (modified?: string) => void;
  onReject: (reason?: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [modified, setModified] = useState(originalSubtask);

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={modified}
            onChange={(e) => setModified(e.target.value)}
            className="text-xs min-h-[60px]"
            placeholder="修改子任务内容..."
          />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setModified(originalSubtask); }}>取消</Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => { onAgree(modified !== originalSubtask ? modified : undefined); setEditing(false); }} disabled={busy}>确认同意</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs text-white" style={{ background: "var(--oc-success)" }} onClick={() => onAgree()} disabled={busy}>接手 →</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)} disabled={busy}>修改子任务</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => onReject()} disabled={busy}>拒绝</Button>
        </div>
      )}
    </div>
  );
}
