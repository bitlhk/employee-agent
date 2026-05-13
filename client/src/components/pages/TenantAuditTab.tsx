/**
 * TenantAuditTab — Day 4 TIL 审计追溯面板
 * 演示卖点 3（合规追溯）的前端入口。
 *
 * 三个视图：
 *   1. 全局统计（顶部 summary + by user / by agent / by action）
 *   2. 按 userId / agentId / 时间范围查 audit 列表
 *   3. 按 tenantToken 反查 → userId + workspace + 完整调用历史
 */
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Loader2, RefreshCw, ShieldCheck, Users, FileSearch, Clock, Search, Eye } from "lucide-react";

function fmtTime(v: unknown): string {
  if (!v) return "-";
  try {
    const d = new Date(v as any);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(v);
  }
}

function shortHex(s: string | null | undefined, n = 16): string {
  if (!s) return "-";
  return s.length > n ? s.slice(0, n) : s;
}

export function TenantAuditTab() {
  // ── Stats ──────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } =
    trpc.claw.adminTenantAuditStats.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });

  // ── List filters ──────────────────────────────────────────────────
  const [filterUserId, setFilterUserId] = useState<string>("");
  const [filterAgentId, setFilterAgentId] = useState<string>("");
  const [filterLimit, setFilterLimit] = useState<string>("100");

  const listInput = useMemo(() => ({
    userId: filterUserId ? parseInt(filterUserId, 10) : undefined,
    agentId: filterAgentId || undefined,
    limit: Math.min(Math.max(parseInt(filterLimit, 10) || 100, 1), 1000),
  }), [filterUserId, filterAgentId, filterLimit]);

  const { data: listData, isLoading: listLoading, refetch: refetchList } =
    trpc.claw.adminTenantAuditList.useQuery(listInput, {
      refetchOnWindowFocus: false,
    });

  // ── Reverse lookup ─────────────────────────────────────────────────
  const [reverseInput, setReverseInput] = useState<string>("");
  const [reverseQuery, setReverseQuery] = useState<string>("");

  const { data: reverseData, isLoading: reverseLoading } =
    trpc.claw.adminTenantAuditReverse.useQuery(
      { tenantToken: reverseQuery },
      { enabled: reverseQuery.length > 0, refetchOnWindowFocus: false },
    );

  return (
    <div className="space-y-6">
      {/* ── 标题 + 刷新 ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-red-600" />
            租户隔离审计
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            演示卖点 3：合规追溯 · 可按用户查记录、按 tenantToken 反查身份、全局统计
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { refetchStats(); refetchList(); }}
          disabled={statsLoading || listLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${statsLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* ── 1. 全局统计卡片 ── */}
      {statsLoading && !stats ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-xs text-gray-500">审计记录</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{stats.totalAudit}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-gray-500">租户映射</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{stats.totalTenantMap}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-gray-500">唯一用户</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{stats.uniqueUsers}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-gray-500">唯一 Tenant</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{stats.uniqueTenants}</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* By User */}
            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
                <Users className="w-4 h-4 text-red-600" /> 按用户
              </div>
              <div className="space-y-1.5">
                {stats.byUser.map((u) => (
                  <div
                    key={u.userId}
                    className="flex items-center justify-between text-xs p-2 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => setFilterUserId(String(u.userId))}
                    title={`点击过滤 uid=${u.userId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-gray-700">#{u.userId}</div>
                      <div className="text-gray-500 truncate">{u.userName || "-"}</div>
                    </div>
                    <div className="text-sm font-semibold text-red-600 ml-2">{u.count}</div>
                  </div>
                ))}
                {stats.byUser.length === 0 && <div className="text-xs text-gray-400 text-center py-4">暂无</div>}
              </div>
            </Card>

            {/* By Agent */}
            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
                <FileSearch className="w-4 h-4 text-red-600" /> 按 Agent
              </div>
              <div className="space-y-1.5">
                {stats.byAgent.map((a) => (
                  <div
                    key={a.agentId}
                    className="flex items-center justify-between text-xs p-2 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => setFilterAgentId(a.agentId)}
                    title={`点击过滤 agent=${a.agentId}`}
                  >
                    <div className="font-mono text-gray-700 truncate">{a.agentId}</div>
                    <div className="text-sm font-semibold text-red-600 ml-2">{a.count}</div>
                  </div>
                ))}
                {stats.byAgent.length === 0 && <div className="text-xs text-gray-400 text-center py-4">暂无</div>}
              </div>
            </Card>

            {/* By Action */}
            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
                <Clock className="w-4 h-4 text-red-600" /> 按 Action
              </div>
              <div className="space-y-1.5">
                {stats.byAction.map((a) => (
                  <div key={a.action} className="flex items-center justify-between text-xs p-2">
                    <div className="font-mono text-gray-700">{a.action}</div>
                    <div className="text-sm font-semibold text-red-600">{a.count}</div>
                  </div>
                ))}
                {stats.byAction.length === 0 && <div className="text-xs text-gray-400 text-center py-4">暂无</div>}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-400 text-center py-6">统计加载失败</div>
      )}

      {/* ── 2. 查询过滤 ── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
          <Search className="w-4 h-4 text-red-600" /> 审计记录查询
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">User ID</Label>
            <Input
              type="number"
              placeholder="例：2"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">Agent ID</Label>
            <Input
              type="text"
              placeholder="例：task-ppt"
              value={filterAgentId}
              onChange={(e) => setFilterAgentId(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">Limit</Label>
            <Input
              type="number"
              value={filterLimit}
              onChange={(e) => setFilterLimit(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setFilterUserId(""); setFilterAgentId(""); setFilterLimit("100"); }}>
              清空
            </Button>
            <Button size="sm" onClick={() => refetchList()} disabled={listLoading}>
              {listLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              查询
            </Button>
          </div>
        </div>

        {/* 结果表格 */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-[11px] text-gray-500 grid grid-cols-12 gap-2 font-medium">
            <div className="col-span-1">ID</div>
            <div className="col-span-2">用户</div>
            <div className="col-span-3">Tenant Short</div>
            <div className="col-span-2">Agent</div>
            <div className="col-span-1">Action</div>
            <div className="col-span-3">时间</div>
          </div>
          <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
            {listData?.rows.map((r) => (
              <div key={r.id} className="px-3 py-1.5 text-xs grid grid-cols-12 gap-2 hover:bg-gray-50">
                <div className="col-span-1 text-gray-400 font-mono">{r.id}</div>
                <div className="col-span-2 truncate">
                  <span className="text-gray-700">#{r.userId}</span>
                  {r.userName && <span className="text-gray-400 ml-1 text-[10px]">{r.userName}</span>}
                </div>
                <div className="col-span-3 font-mono text-red-600 text-[11px]">
                  <span className="cursor-pointer hover:underline" onClick={() => { setReverseInput(r.tenantShort); setReverseQuery(r.tenantShort); }}>
                    {r.tenantShort}
                  </span>
                </div>
                <div className="col-span-2 font-mono text-gray-700 truncate">{r.agentId}</div>
                <div className="col-span-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    r.action === "chat_send" ? "bg-blue-50 text-blue-600" :
                    r.action === "chat_done" ? "bg-green-50 text-green-600" :
                    "bg-gray-100 text-gray-600"
                  }`}>{r.action}</span>
                </div>
                <div className="col-span-3 text-gray-500 text-[11px]">{fmtTime(r.createdAt)}</div>
              </div>
            ))}
            {listData && listData.rows.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-6">无记录</div>
            )}
            {!listData && listLoading && (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
            )}
          </div>
          {listData && (
            <div className="px-3 py-1.5 bg-gray-50 text-[10px] text-gray-500 text-right">
              共 {listData.count} 条
            </div>
          )}
        </div>
      </Card>

      {/* ── 3. Tenant 反查 ── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
          <Eye className="w-4 h-4 text-red-600" /> Tenant Token 反查（脱敏身份恢复）
        </div>
        <div className="flex items-end gap-2 mb-3">
          <div className="flex-1">
            <Label className="text-xs text-gray-500 mb-1 block">Tenant Token（完整 64 字符或前 16 字符）</Label>
            <Input
              type="text"
              placeholder="例：aa28834e867fc8aa"
              value={reverseInput}
              onChange={(e) => setReverseInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setReverseQuery(reverseInput.trim()); }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <Button size="sm" onClick={() => setReverseQuery(reverseInput.trim())} disabled={!reverseInput.trim()}>
            {reverseLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
            反查
          </Button>
        </div>
        {reverseData && reverseData.userId && (
          <div className="border border-red-100 rounded-lg bg-red-50/30 p-3 space-y-2">
            <div className="text-xs">
              <span className="text-gray-500">关联用户：</span>
              <span className="font-semibold text-red-700">#{reverseData.userId}</span>
              {reverseData.userName && <span className="text-gray-700 ml-2">{reverseData.userName}</span>}
              {reverseData.userEmail && <span className="text-gray-500 ml-2 text-[11px]">{reverseData.userEmail}</span>}
            </div>
            <div className="text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500">Agent：</span>
                <span className="font-mono text-gray-700">{reverseData.agentId || "-"}</span>
              </div>
              <div>
                <span className="text-gray-500">消息数：</span>
                <span className="text-gray-700">{reverseData.messageCount ?? 0}</span>
              </div>
              <div>
                <span className="text-gray-500">首次使用：</span>
                <span className="text-gray-700 text-[11px]">{fmtTime(reverseData.firstUsedAt)}</span>
              </div>
              <div>
                <span className="text-gray-500">最近使用：</span>
                <span className="text-gray-700 text-[11px]">{fmtTime(reverseData.lastUsedAt)}</span>
              </div>
            </div>
            {reverseData.workspacePath && (
              <div className="text-xs">
                <span className="text-gray-500">Workspace：</span>
                <div className="font-mono text-[10px] text-gray-600 break-all bg-white rounded px-2 py-1 mt-1">
                  {reverseData.workspacePath}
                </div>
              </div>
            )}
            <div className="text-xs">
              <span className="text-gray-500">调用历史（最近 200 条）：</span>
              <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                {reverseData.auditHistory.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded bg-white">
                    <span className="text-gray-400 font-mono">#{h.id}</span>
                    <span className={`px-1 rounded text-[10px] ${
                      h.action === "chat_send" ? "bg-blue-50 text-blue-600" :
                      h.action === "chat_done" ? "bg-green-50 text-green-600" :
                      "bg-gray-100 text-gray-600"
                    }`}>{h.action}</span>
                    <span className="text-gray-500 flex-1">{fmtTime(h.createdAt)}</span>
                  </div>
                ))}
                {reverseData.auditHistory.length === 0 && (
                  <div className="text-gray-400 text-center py-2">无调用历史</div>
                )}
              </div>
            </div>
          </div>
        )}
        {reverseData && !reverseData.userId && reverseQuery.length > 0 && (
          <div className="text-xs text-gray-400 text-center py-4">未找到对应 tenant（可能尚未被任何用户使用过）</div>
        )}
      </Card>
    </div>
  );
}
