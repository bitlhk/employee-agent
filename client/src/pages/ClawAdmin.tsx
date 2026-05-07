/**
 * ClawAdmin — 灵虾管理控制台（独立页面）
 * 风格：白色主题，与灵感官网/ClawHome 一致
 * Tab: 实例管理 / 系统设置 / 组织协作
 */

import { useState, useEffect } from "react";
import { BrandIcon } from "@/components/BrandIcon";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, ArrowLeft, Search, Users, Settings, RefreshCw, Sparkles, Zap, BarChart3, ShieldCheck, Building2 } from "lucide-react";
import { UsageStatsTab } from "@/components/pages/UsageStatsTab";
import { TenantAuditTab } from "@/components/pages/TenantAuditTab";
import { BizAgentsPanel } from "@/components/BizAgentsPanel";
import { CollaborationTab } from "./admin/CollaborationTab";
import { toast } from "sonner";
import { useBrand, invalidateBrandClientCache } from "@/lib/useBrand";
import { BRAND_PRESETS } from "@shared/brand";

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "creating", label: "创建中" },
  { value: "active", label: "启用" },
  { value: "expiring", label: "即将到期" },
  { value: "recycled", label: "停用" },
  { value: "failed", label: "失败" },
] as const;

const PERMISSION_OPTIONS = [
  { value: "plus", label: "员工" },
  { value: "internal", label: "管理员" },
] as const;

const formatStatus = (status?: string) =>
  STATUS_OPTIONS.find((s) => s.value === status)?.label || status || "-";

const formatExpiry = (row: any) => {
  if (!row?.expiresAt || Number(row?.ttlDays || 0) <= 0) return "长期有效";
  return new Date(row.expiresAt).toLocaleDateString("zh-CN");
};

const STATUS_COLORS: Record<string, string> = {
  total: "#6366f1",
  active: "#22c55e",
  creating: "#3b82f6",
  expiring: "#f59e0b",
  recycled: "#9ca3af",
  failed: "#ef4444",
};

function BrandSettingsPanel() {
  const brand = useBrand();
  const [form, setForm] = useState({
    name: brand.name,
    nameEn: brand.nameEn,
    platform: brand.platform,
    platformEn: brand.platformEn,
    slogan: brand.slogan,
    accentColor: brand.accentColor,
    logo: brand.logo,
    favicon: brand.favicon,
    systemPrompt: brand.systemPrompt,
    agentIdentity: brand.agentIdentity,
    githubUrl: brand.githubUrl,
    pageTitle: brand.pageTitle,
  });
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const match = BRAND_PRESETS.find(p => p.config.nameEn === brand.nameEn);
    return match?.id || "custom";
  });

  const applyPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    if (presetId === "custom") return;
    const preset = BRAND_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setForm({ ...preset.config });
  };

  // Sync from brand when loaded
  useEffect(() => {
    setForm({
      name: brand.name,
      nameEn: brand.nameEn,
      platform: brand.platform,
      platformEn: brand.platformEn,
      slogan: brand.slogan,
      accentColor: brand.accentColor,
      logo: brand.logo,
      favicon: brand.favicon,
      systemPrompt: brand.systemPrompt,
      agentIdentity: brand.agentIdentity,
      githubUrl: brand.githubUrl,
      pageTitle: brand.pageTitle,
    });
  }, [brand]);

  const setBrandMutation = trpc.claw.adminSetBrand.useMutation({
    onSuccess: () => {
      invalidateBrandClientCache();
      toast.success("品牌设置已保存，刷新页面后生效");
      setSaving(false);
    },
    onError: (e: any) => {
      toast.error(e?.message || "保存失败");
      setSaving(false);
    },
  });

  const saveBrand = () => {
    setSaving(true);
    setBrandMutation.mutate(form);
  };

  const field = (key: keyof typeof form, label: string, opts?: { type?: string; rows?: number; placeholder?: string }) => (
    <div className="space-y-1" key={key}>
      <Label className="text-sm text-gray-700">{label}</Label>
      {opts?.rows ? (
        <textarea
          className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          rows={opts.rows}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={opts?.placeholder}
        />
      ) : (
        <Input
          type={opts?.type || "text"}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={opts?.placeholder}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 模板选择器 */}
      <Card className="p-6 border-border/50 bg-white/80">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">品牌模板</h3>
        <p className="text-xs text-muted-foreground mb-4">选择预设模板一键填充，也可以选"自定义"后手动编辑</p>
        <div className="grid grid-cols-5 gap-2">
          {BRAND_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className="text-left rounded-lg border p-3 transition-all hover:shadow-sm"
              style={{
                borderColor: selectedPreset === p.id ? p.config.accentColor : "rgba(0,0,0,0.08)",
                background: selectedPreset === p.id ? `${p.config.accentColor}08` : "white",
                boxShadow: selectedPreset === p.id ? `0 0 0 2px ${p.config.accentColor}30` : "none",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-4 h-4 rounded-full shrink-0"
                  style={{ background: p.config.accentColor }}
                />
                <span className="text-sm font-medium text-gray-900 truncate">{p.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{p.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6 space-y-5 border-border/50 bg-white/80">
        <h3 className="text-sm font-semibold text-gray-900">基本信息</h3>
        <div className="grid grid-cols-2 gap-4">
          {field("name", "产品名称（中文）", { placeholder: "灵虾" })}
          {field("nameEn", "产品名称（英文）", { placeholder: "LingganClaw" })}
          {field("platform", "平台名称（中文）", { placeholder: "灵感" })}
          {field("platformEn", "平台名称（英文）", { placeholder: "Linggan" })}
        </div>
        {field("slogan", "标语")}
        {field("pageTitle", "页面标题")}
      </Card>

      <Card className="p-6 space-y-5 border-border/50 bg-white/80">
        <h3 className="text-sm font-semibold text-gray-900">视觉</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-sm text-gray-700">主题色</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
                className="w-10 h-8 rounded border cursor-pointer"
              />
              <Input
                value={form.accentColor}
                onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
                className="w-28 font-mono text-sm"
              />
            </div>
          </div>
          {field("logo", "Logo 路径", { placeholder: "/images/lingxia.svg" })}
        </div>
        {field("favicon", "Favicon 路径", { placeholder: "/favicon.png" })}
      </Card>

      <Card className="p-6 space-y-5 border-border/50 bg-white/80">
        <h3 className="text-sm font-semibold text-gray-900">AI 身份</h3>
        {field("systemPrompt", "System Prompt（英文，安全提示首句）", { rows: 2 })}
        {field("agentIdentity", "Agent 身份自我介绍（中文，写入 SOUL.md）", { rows: 2 })}
      </Card>

      <Card className="p-6 space-y-3 border-border/50 bg-white/80">
        <h3 className="text-sm font-semibold text-gray-900">其他</h3>
        {field("githubUrl", "开源仓库 URL")}
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveBrand} disabled={saving}>
          {saving ? "保存中..." : "保存品牌设置"}
        </Button>
      </div>
    </div>
  );
}

export default function ClawAdmin() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("instances");
  const [keyword, setKeyword] = useState("");
  const [viewingSkillId, setViewingSkillId] = useState<number | null>(null);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [skillUploading, setSkillUploading] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // ── 实例管理 ──
  const { data: listData, isLoading: listLoading, refetch: refetchList } = trpc.claw.adminList.useQuery(
    { keyword: keyword || undefined, status: statusFilter as any },
    { retry: false }
  );

  const updateMutation = trpc.claw.adminUpdate.useMutation({
    retry: false,
    onSuccess: () => { refetchList(); toast.success("已更新"); },
    onError: (e: any) => toast.error(e?.message || "更新失败"),
  });

  const batchUpdateMutation = trpc.claw.adminBatchUpdate.useMutation({
    retry: false,
    onSuccess: () => { refetchList(); setSelectedIds([]); toast.success("批量更新完成"); },
    onError: (e: any) => toast.error(e?.message || "批量更新失败"),
  });

  // ── 系统配置 ──
  const { data: configData, refetch: refetchConfig } = trpc.claw.adminGetConfig.useQuery(undefined, {
    enabled: activeTab === "settings",
    retry: false,
  });

  const { data: sharedSkills, isLoading: skillsLoading, refetch: refetchSkills } = trpc.claw.adminListSharedSkills.useQuery(undefined, {
    enabled: activeTab === "skills",
    retry: false,
  });

  const { data: marketSkills, isLoading: marketLoading, refetch: refetchMarket } = trpc.claw.adminListMarketSkills.useQuery(undefined, {
    enabled: activeTab === "skills",
    retry: false,
  });
  const publishSkillMutation = trpc.claw.adminPublishSkill.useMutation({
    onSuccess: () => { refetchMarket(); toast.success("发布成功"); },
    onError: (e: any) => toast.error(e?.message || "发布失败"),
  });
  const reviewSkillMutation = trpc.claw.adminReviewSkill.useMutation({
    onSuccess: () => { refetchMarket(); toast.success("已更新"); },
    onError: (e: any) => toast.error(e?.message || "操作失败"),
  });
  const deleteMarketSkillMutation = trpc.claw.adminDeleteMarketSkill.useMutation({
    onSuccess: () => { refetchMarket(); toast.success("已删除"); },
    onError: (e: any) => toast.error(e?.message || "删除失败"),
  });

  const { data: viewSkillSource, refetch: refetchSkillSource } = trpc.claw.adminViewSkillSource.useQuery(
    { id: viewingSkillId! },
    { enabled: !!viewingSkillId, retry: false }
  );
  const viewSourceFiles = Array.isArray((viewSkillSource as any)?.sourceFiles)
    ? (viewSkillSource as any).sourceFiles
    : [];

  const handleAiReview = async (skillId: number) => {
    setAiReviewing(true);
    setAiReviewResult(null);
    try {
      const res = await fetch("/api/claw/admin/ai-review-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skillMarketId: skillId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI 审核请求失败");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let result = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.chunk) { result += d.chunk; setAiReviewResult(result); }
              if (d.done) break;
            } catch {}
          }
        }
      }
      if (!result) setAiReviewResult("未获取到审核结果");
    } catch (e: any) {
      setAiReviewResult("审核失败: " + (e.message || ""));
    } finally {
      setAiReviewing(false);
    }
  };

  const handleSkillUpload = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      toast.error("请上传 .zip 技能包");
      return;
    }
    setSkillUploading(true);
    try {
      const res = await fetch("/api/claw/skill-market/upload", {
        method: "POST",
        headers: { "x-skill-filename": encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "上传失败"); return; }
      if (!data.marketItemId) {
        await publishSkillMutation.mutateAsync({
          skillId: data.uploadId || data.name,
          name: data.name,
          description: data.description,
          author: "管理员上传",
          origin: "opensource",
          status: "pending",
        });
      }
      await refetchMarket();
      toast.success(`已上传并进入待审核: ${data.name}`);
    } catch (e: any) {
      toast.error("上传失败: " + (e.message || ""));
    } finally {
      setSkillUploading(false);
    }
  };

  const setConfigMutation = trpc.claw.adminSetConfig.useMutation({
    retry: false,
    onSuccess: () => { refetchConfig(); toast.success("配置已保存"); },
    onError: (e: any) => toast.error(e?.message || "保存失败"),
  });

  // ── 权限检查 ──
  if (!user || (user as any)?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-muted-foreground">无权访问管理页面</p>
      </div>
    );
  }

  const summary = listData?.summary;
  const rows = listData?.rows || [];

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const toggleSelectAll = () => {
    if (selectedIds.length === rows.length) setSelectedIds([]);
    else setSelectedIds(rows.map((r: any) => r.id));
  };

  const navItems = [
    { value: "instances", label: "实例管理", description: "子虾实例与权限", icon: Users },
    { value: "collaboration", label: "组织协作", description: "空间、成员与准入", icon: Building2 },
    { value: "skills", label: "技能广场", description: "上架、审核与共享", icon: Sparkles },
    { value: "usage", label: "使用统计", description: "访问与使用趋势", icon: BarChart3 },
    { value: "settings", label: "系统设置", description: "灵虾运行配置", icon: Settings },
    { value: "brand", label: "品牌设置", description: "名称、视觉与身份", icon: Sparkles },
    { value: "collab", label: "智能体协作", description: "协作能力管理", icon: Zap },
    { value: "tenant-audit", label: "隔离审计", description: "租户隔离检查", icon: ShieldCheck },
  ];

  return (
    <div className="claw-admin-shell min-h-screen bg-gradient-to-b from-white to-gray-50/80">
      {/* Header */}
      <header className="claw-admin-header sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-border/50">
        <div className="container flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="claw-admin-back-button">
              <ArrowLeft className="w-4 h-4 mr-1" />
              首页
            </Button>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <BrandIcon size={24} />
              <h1 className="claw-admin-title text-base font-semibold text-gray-900">灵虾管理</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto w-full max-w-[1440px] p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="claw-admin-sidebar sticky top-6 max-h-[calc(100vh-3rem)] self-start overflow-y-auto rounded-2xl border border-gray-200 bg-white/90 p-3 shadow-sm">
            <div className="px-3 py-2">
              <div className="claw-admin-sidebar-kicker text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Console</div>
              <div className="claw-admin-sidebar-title mt-1 text-sm font-semibold text-gray-900">管理导航</div>
            </div>
            <TabsList className="mt-2 grid h-auto gap-1 bg-transparent p-0">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="claw-admin-nav-item group h-auto justify-start rounded-xl border border-transparent px-3 py-3 text-left text-gray-600 transition"
                  >
                    <Icon className="claw-admin-nav-icon mr-3 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-none">{item.label}</span>
                      <span className="mt-1 block truncate text-[11px] font-normal text-gray-400 group-data-[state=active]:text-red-500">{item.description}</span>
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </aside>

          <section className="min-w-0">

          {/* ── 实例管理 ── */}
          <TabsContent value="instances" className="space-y-4">
            {/* 概览 */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {(["total", "active", "creating", "expiring", "recycled", "failed"] as const).map((key) => (
                  <Card key={key} className="p-3 text-center border-border/50 bg-white/80">
                    <p className="text-2xl font-bold" style={{ color: STATUS_COLORS[key] }}>{summary[key]}</p>
                    <p className="text-xs mt-1 text-muted-foreground">
                      {key === "total" ? "总计" : STATUS_OPTIONS.find((s) => s.value === key)?.label || key}
                    </p>
                  </Card>
                ))}
              </div>
            )}

            {/* 搜索 & 过滤 */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索 adoptId / 用户名…"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => refetchList()} className="text-muted-foreground">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {/* 批量操作 */}
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                <span className="text-sm font-medium text-gray-700">已选 {selectedIds.length} 项</span>
                <Select onValueChange={(v) => batchUpdateMutation.mutate({ ids: selectedIds, status: v as any })}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue placeholder="改状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.filter((s) => s.value !== "all").map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select onValueChange={(v) => batchUpdateMutation.mutate({ ids: selectedIds, permissionProfile: v as any })}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue placeholder="改角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])} className="text-muted-foreground">
                  取消
                </Button>
              </div>
            )}

            {/* 列表 */}
            {listLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Card className="border-border/50 bg-white/80 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-border/50">
                      <th className="p-3 text-left w-10">
                        <input type="checkbox" checked={selectedIds.length === rows.length && rows.length > 0} onChange={toggleSelectAll} />
                      </th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Adopt ID</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">用户</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Organization</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">Group</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">状态</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">角色</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">有效期</th>
                      <th className="p-3 text-left font-medium text-muted-foreground">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: any) => (
                      <tr key={row.id} className="border-t border-border/30 hover:bg-gray-50/50 transition-colors">
                        <td className="p-3">
                          <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelect(row.id)} />
                        </td>
                        <td className="p-3 font-mono text-xs text-gray-900">{row.adoptId}</td>
                        <td className="p-3 text-xs text-muted-foreground">{row.userName || row.userEmail || `#${row.userId}`}</td>
                        <td className="p-3 text-xs text-muted-foreground">{row.organizationName || "—"}</td>
                        <td className="p-3 text-xs">
                          {row.userGroupId && row.userGroupId > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                              <span className="font-medium">{row.groupName || `#${row.userGroupId}`}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">默认/外部</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLORS[row.status] || "#9ca3af" }} />
                            <span style={{ color: STATUS_COLORS[row.status] || "#6b7280" }}>{formatStatus(row.status)}</span>
                          </span>
                        </td>
                        <td className="p-3">
                          <Select
                            value={row.permissionProfile === "internal" ? "internal" : "plus"}
                            onValueChange={(v) => updateMutation.mutate({ id: row.id, permissionProfile: v as any })}
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PERMISSION_OPTIONS.map((p) => (
                                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{formatExpiry(row)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {row.status !== "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => updateMutation.mutate({ id: row.id, status: "active" })}
                              >
                                启用
                              </Button>
                            )}
                            {row.status === "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={() => updateMutation.mutate({ id: row.id, status: "recycled" })}
                              >
                                停用
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-muted-foreground">暂无数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            )}
          </TabsContent>

          {/* ── 系统设置 ── */}
          <TabsContent value="settings" className="space-y-6">
            <Card className="p-6 space-y-5 border-border/50 bg-white/80">
              <h3 className="text-sm font-semibold text-gray-900">灵虾配置</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm text-gray-700">可见性</Label>
                    <p className="text-xs mt-0.5 text-muted-foreground">public = 所有注册用户可领养，internal = 仅白名单用户</p>
                  </div>
                  <Select
                    value={configData?.visibility || "internal"}
                    onValueChange={(v) => setConfigMutation.mutate({ visibility: v as any })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-px bg-border/50" />

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm text-gray-700">默认有效期</Label>
                    <p className="text-xs mt-0.5 text-muted-foreground">0 表示长期有效，适合企业内部员工默认使用</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="w-20 text-center"
                      defaultValue={configData?.defaultTtlDays ?? 0}
                      min={0}
                      max={365}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value);
                        if (v >= 0 && v <= 365) setConfigMutation.mutate({ defaultTtlDays: v });
                      }}
                    />
                    <span className="text-xs text-muted-foreground">天</span>
                  </div>
                </div>

                <div className="h-px bg-border/50" />

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm text-gray-700">默认角色</Label>
                    <p className="text-xs mt-0.5 text-muted-foreground">角色用于灵虾层管理，底层 OpenClaw 统一使用 coding profile 并叠加限制</p>
                  </div>
                  <Select
                    value={configData?.defaultProfile === "internal" ? "internal" : "plus"}
                    onValueChange={(v) => setConfigMutation.mutate({ defaultProfile: v as any })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plus">员工</SelectItem>
                      <SelectItem value="internal">管理员</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ── 品牌设置 ── */}
          <TabsContent value="brand" className="space-y-6">
            <BrandSettingsPanel />
          </TabsContent>

          {/* ── 技能广场 ── */}
          <TabsContent value="skills" className="space-y-4">
            {/* 上传区 */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">上传开源社区技能</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">管理员上传的 .zip 技能包默认进入“开源社区”，解析后进入待审核</p>
                </div>
              </div>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/40"
                onClick={() => document.getElementById("skill-upload-input")?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--primary)"; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = ""; }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "";
                  if (skillUploading) return;
                  const file = e.dataTransfer.files[0];
                  if (!file) return;
                  await handleSkillUpload(file);
                }}
              >
                <p className="text-sm text-muted-foreground">{skillUploading ? "正在上传并解析技能包..." : "拖拽 .zip 文件到此处，或点击选择"}</p>
                <input id="skill-upload-input" type="file" accept=".zip" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file && !skillUploading) await handleSkillUpload(file);
                  e.target.value = "";
                }} />
              </div>
            </Card>

            {/* 广场技能列表 */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">技能广场管理</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">审核、上下架、管理广场中的共享技能</p>
                </div>
                <Button size="sm" variant="outline" className="admin-secondary-action" onClick={() => refetchMarket()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />刷新
                </Button>
              </div>
              {marketLoading ? (
                <div className="flex items-center gap-2 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  {(marketSkills || []).map((item: any) => {
                    const catLabels: any = { finance: "金融", dev: "开发", data: "数据", writing: "写作", general: "通用" };
                    const originLabels: any = { opensource: "开源社区", squad: "中队原创" };
                    const stLabels: any = { pending: "待审核", approved: "已上架", rejected: "已拒绝", offline: "已下架" };
                    const stColors: any = { pending: "bg-yellow-50 text-yellow-700 border-yellow-200", approved: "bg-green-50 text-green-700 border-green-200", rejected: "bg-red-50 text-red-700 border-red-200", offline: "bg-gray-50 text-gray-500 border-gray-200" };
                    return (
                      <div key={item.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-gray-900">{item.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">{item.skillId}</span>
                              <span className={"text-[10px] px-1.5 py-0.5 rounded border font-medium " + (stColors[item.status] || "")}>{stLabels[item.status] || item.status}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">{originLabels[item.origin || "opensource"] || item.origin || "开源社区"}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">{catLabels[item.category] || item.category}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{item.description || "—"}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              v{item.version} · {item.author} · {item.license} · 安装 {item.downloadCount} 次
                              {item.reviewNote && <span className="ml-2 text-yellow-600">审核备注: {item.reviewNote}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button size="sm" variant="outline" className="admin-secondary-action h-7 text-xs" onClick={() => {
                              setViewingSkillId(item.id);
                              setAiReviewResult(null);
                            }}>查看源码</Button>
                            <Button size="sm" variant="outline" className="admin-secondary-action h-7 text-xs" disabled={aiReviewing} onClick={() => {
                              setViewingSkillId(item.id);
                              handleAiReview(item.id);
                            }}>{aiReviewing ? "AI审核中…" : "AI 审核"}</Button>
                            {item.status === "pending" && (
                              <>
                                <Button size="sm" className="admin-success-action h-7 text-xs" onClick={() => reviewSkillMutation.mutate({ id: item.id, status: "approved" })}>通过</Button>
                                <Button size="sm" variant="destructive" className="admin-danger-action h-7 text-xs" onClick={() => {
                                  const note = prompt("拒绝原因：");
                                  if (note !== null) reviewSkillMutation.mutate({ id: item.id, status: "rejected", reviewNote: note || "不符合要求" });
                                }}>拒绝</Button>
                              </>
                            )}
                            {item.status === "approved" && (
                              <Button size="sm" variant="outline" className="admin-secondary-action h-7 text-xs" onClick={() => reviewSkillMutation.mutate({ id: item.id, status: "offline" })}>下架</Button>
                            )}
                            {(item.status === "offline" || item.status === "rejected") && (
                              <Button size="sm" variant="outline" className="admin-secondary-action h-7 text-xs" onClick={() => reviewSkillMutation.mutate({ id: item.id, status: "approved" })}>重新上架</Button>
                            )}
                            <Button size="sm" variant="ghost" className="admin-danger-ghost-action h-7 text-xs" onClick={() => { if (confirm("确定删除？")) deleteMarketSkillMutation.mutate({ id: item.id }); }}>删除</Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!marketSkills || marketSkills.length === 0) && (
                    <div className="text-xs text-center py-6 text-muted-foreground">暂无广场技能，从上方上传添加</div>
                  )}
                </div>
              )}
            </Card>

            {/* 源码查看弹窗 */}
            {viewingSkillId && (
              <Card className="admin-panel-card p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">源码查看</h3>
                  <Button size="sm" variant="outline" className="admin-secondary-action h-7 text-xs" onClick={() => setViewingSkillId(null)}>关闭</Button>
                </div>
                {viewSkillSource ? (
                  <div>
                    <div className="text-xs font-medium text-gray-700 mb-1">SKILL.md</div>
                    <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">{viewSkillSource.skillMd || "(无)"}</pre>
                    {viewSourceFiles.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        <div className="text-xs font-medium text-gray-700">源码文件</div>
                        {viewSourceFiles.map((file: any) => (
                          <div key={file.path} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2">
                              <span className="min-w-0 truncate font-mono text-[11px] text-gray-700">{file.path}</span>
                              <span className="shrink-0 text-[10px] text-gray-400">{file.size} bytes</span>
                            </div>
                            <pre className="max-h-72 overflow-auto bg-gray-50/60 p-3 text-xs font-mono text-gray-800 whitespace-pre">{file.content || "(空文件)"}</pre>
                          </div>
                        ))}
                      </div>
                    ) : viewSkillSource.scripts?.length > 0 ? (
                      <div className="mt-4">
                        <div className="text-xs font-medium text-gray-700 mb-1">脚本文件</div>
                        <div className="flex flex-wrap gap-1.5">
                          {viewSkillSource.scripts.map((s: string) => (
                            <span key={s} className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-700 font-mono">{s}</span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-muted-foreground">暂无脚本源码文件</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-2">路径: {viewSkillSource.dir}</div>
                    {aiReviewResult && (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-gray-700 mb-1">AI 审核意见</div>
                        <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-auto">{aiReviewResult}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground inline-block" /></div>
                )}
              </Card>
            )}
          </TabsContent>

          {/* ── 智能体协作 ── */}
          <TabsContent value="collab" className="space-y-4">
            <Card className="admin-panel-card p-6">
              <BizAgentsPanel />
            </Card>
          </TabsContent>
          <TabsContent value="collaboration" className="space-y-4">
            <CollaborationTab />
          </TabsContent>
          <TabsContent value="usage" className="space-y-4">            <UsageStatsTab />          </TabsContent>
          <TabsContent value="tenant-audit" className="space-y-4">            <TenantAuditTab />          </TabsContent>
          </section>
        </Tabs>
      </main>
    </div>
  );
}
