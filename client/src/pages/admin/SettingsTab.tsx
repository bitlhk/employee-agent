import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  RefreshCw,
  Shield,
  XCircle,
  Eye,
  Settings,
  Mail,
  Send,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatDate, scenarioNames } from "./utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

export function SettingsTab() {
  const { confirm, dialog } = useConfirmDialog();
  // SMTP 配置相关
  const [smtpFormData, setSmtpFormData] = useState<{
    host: string;
    port: string;
    user: string;
    password: string;
    from: string;
    enabled: "yes" | "no";
  }>({
    host: "",
    port: "",
    user: "",
    password: "",
    from: "",
    enabled: "no",
  });
  const [testEmail, setTestEmail] = useState("");

  const { data: smtpConfig, isLoading: loadingSmtpConfig, refetch: refetchSmtpConfig } =
    trpc.smtp.get.useQuery(undefined);

  const updateSmtpConfig = trpc.smtp.update.useMutation({
    onSuccess: () => {
      toast.success("SMTP配置保存成功！");
      refetchSmtpConfig();
    },
    onError: (error) => {
      toast.error(error.message || "保存SMTP配置失败");
    },
  });

  const testSmtp = trpc.smtp.test.useMutation({
    onSuccess: () => {
      toast.success("测试邮件发送成功，请检查邮箱！");
    },
    onError: (error) => {
      toast.error(error.message || "发送测试邮件失败，请检查配置");
    },
  });

  useEffect(() => {
    if (smtpConfig) {
      setSmtpFormData({
        host: smtpConfig.host ?? "",
        port: smtpConfig.port ?? "",
        user: smtpConfig.user ?? "",
        password: "",
        from: smtpConfig.from || "",
        enabled: smtpConfig.enabled,
      });
    }
  }, [smtpConfig]);

  // 功能开关相关
  const { data: featureFlagsData, isLoading: loadingFeatureFlags, refetch: refetchFeatureFlags } =
    trpc.featureFlags.list.useQuery(undefined);

  const featureFlags = Array.isArray(featureFlagsData) ? featureFlagsData : [];

  const updateFeatureFlag = trpc.featureFlags.update.useMutation({
    onSuccess: () => {
      toast.success("功能开关更新成功！");
      refetchFeatureFlags();
    },
    onError: (error) => {
      toast.error(error.message || "更新功能开关失败");
    },
  });

  // 未注册用户每日访问限制配置
  const { data: dailyLimitData, isLoading: loadingDailyLimit, refetch: refetchDailyLimit } =
    trpc.systemConfigs.getUnregisteredDailyLimit.useQuery(undefined);

  const [dailyLimit, setDailyLimit] = useState<number>(10);
  const setDailyLimitMutation = trpc.systemConfigs.setUnregisteredDailyLimit.useMutation({
    onSuccess: () => {
      toast.success("访问限制配置已更新");
      refetchDailyLimit();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (dailyLimitData?.limit !== undefined) {
      setDailyLimit(dailyLimitData.limit);
    }
  }, [dailyLimitData]);

  // 自动封禁 4xx 错误阈值配置
  const { data: autoBlockThresholdData, isLoading: loadingAutoBlockThreshold, refetch: refetchAutoBlockThreshold } =
    trpc.systemConfigs.getAutoBlock4xxThreshold.useQuery(undefined);

  const [autoBlockThreshold, setAutoBlockThreshold] = useState<number>(30);
  const setAutoBlockThresholdMutation = trpc.systemConfigs.setAutoBlock4xxThreshold.useMutation({
    onSuccess: () => {
      toast.success("自动封禁阈值配置已更新");
      refetchAutoBlockThreshold();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (autoBlockThresholdData?.threshold !== undefined) {
      setAutoBlockThreshold(autoBlockThresholdData.threshold);
    }
  }, [autoBlockThresholdData]);

  // 内部访问白名单配置
  const { data: internalWhitelistData, refetch: refetchInternalWhitelist } =
    trpc.systemConfigs.getInternalAccessWhitelist.useQuery(undefined);
  const [internalWhitelistText, setInternalWhitelistText] = useState("");
  const setInternalWhitelistMutation = trpc.systemConfigs.setInternalAccessWhitelist.useMutation({
    onSuccess: () => {
      toast.success("内部访问白名单已更新");
      refetchInternalWhitelist();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (typeof internalWhitelistData?.value === "string") {
      setInternalWhitelistText(internalWhitelistData.value);
    }
  }, [internalWhitelistData]);

  // 不走 iframe 的体验ID配置
  const { data: iframeBypassData, refetch: refetchIframeBypass } =
    trpc.systemConfigs.getIframeBypassExperienceIds.useQuery(undefined);
  const [iframeBypassText, setIframeBypassText] = useState("");
  const setIframeBypassMutation = trpc.systemConfigs.setIframeBypassExperienceIds.useMutation({
    onSuccess: () => {
      toast.success("不内嵌体验配置已更新");
      refetchIframeBypass();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (typeof iframeBypassData?.value === "string") {
      setIframeBypassText(iframeBypassData.value);
    }
  }, [iframeBypassData]);

  // 场景管理相关
  const [editingScenario, setEditingScenario] = useState<{
    id: string;
    title: string;
    subtitle: string;
    description: string;
    icon: string;
    displayOrder: number;
    status: "active" | "hidden";
  } | null>(null);

  const { data: scenariosData, isLoading: loadingScenarios, refetch: refetchScenarios } =
    trpc.scenarios.list.useQuery(undefined);

  const managedScenarios = Array.isArray(scenariosData) ? scenariosData : [];

  const scenarioNameMap = useMemo(() => {
    const dbMap: Record<string, string> = {};
    managedScenarios.forEach((s) => {
      dbMap[s.id] = s.title;
    });
    return { ...scenarioNames, ...dbMap };
  }, [managedScenarios]);

  const createScenarioMutation = trpc.scenarios.create.useMutation({
    onSuccess: () => {
      toast.success("场景创建成功！");
      refetchScenarios();
      setEditingScenario(null);
    },
    onError: (error) => {
      toast.error(error.message || "场景创建失败");
    },
  });

  const updateScenarioMutation = trpc.scenarios.update.useMutation({
    onSuccess: () => {
      toast.success("场景更新成功！");
      refetchScenarios();
      setEditingScenario(null);
    },
    onError: (error) => {
      toast.error(error.message || "场景更新失败");
    },
  });

  const deleteScenarioMutation = trpc.scenarios.delete.useMutation({
    onSuccess: () => {
      toast.success("场景删除成功！");
      refetchScenarios();
      refetchExperienceConfigs();
    },
    onError: (error) => {
      toast.error(error.message || "场景删除失败");
    },
  });

  // 场景体验配置相关
  const [editingConfig, setEditingConfig] = useState<{
    id?: number;
    experienceId: string;
    title: string;
    description: string;
    url: string;
    scenarioId: string;
    status: "active" | "developing";
    visibility: "public" | "internal";
    displayOrder: number;
    icon: string;
    tag: string;
    features: string[];
  } | null>(null);

  const { data: experienceConfigsData, isLoading: loadingExperienceConfigs, refetch: refetchExperienceConfigs } =
    trpc.experienceConfigs.list.useQuery(undefined);

  const experienceConfigs = Array.isArray(experienceConfigsData) ? experienceConfigsData : [];

  const createExperienceConfig = trpc.experienceConfigs.create.useMutation({
    onSuccess: (data) => {
      toast.success("场景体验配置创建成功！");
      if (data?.publish?.ok) {
        toast.success(data.publish.message || "路由发布成功");
      } else {
        toast.error(data?.publish?.message || "路由发布失败，请稍后重试");
      }
      refetchExperienceConfigs();
      setEditingConfig(null);
    },
    onError: (error) => {
      toast.error(error.message || "创建配置失败");
    },
  });

  const updateExperienceConfig = trpc.experienceConfigs.update.useMutation({
    onSuccess: (data) => {
      toast.success("场景体验配置更新成功！");
      if (data?.publish?.ok) {
        toast.success(data.publish.message || "路由发布成功");
      } else {
        toast.error(data?.publish?.message || "路由发布失败，请稍后重试");
      }
      refetchExperienceConfigs();
      setEditingConfig(null);
    },
    onError: (error) => {
      toast.error(error.message || "更新配置失败");
    },
  });

  const deleteExperienceConfig = trpc.experienceConfigs.delete.useMutation({
    onSuccess: () => {
      toast.success("场景体验配置删除成功！");
      refetchExperienceConfigs();
    },
    onError: (error) => {
      toast.error(error.message || "删除配置失败");
    },
  });

  const publishRoutesMutation = trpc.experienceConfigs.publishRoutes.useMutation({
    onSuccess: (data) => {
      if (data?.ok) toast.success(data.message || "路由发布成功");
      else toast.error(data?.message || "路由发布失败");
      refetchExperienceConfigs();
    },
    onError: (error) => {
      toast.error(error.message || "路由发布失败");
    },
  });

  const handleDeleteScenario = async (scenario: { id: string; title: string }) => {
    const ok = await confirm({
      title: "删除场景？",
      description: `确定删除场景 ${scenario.title} 吗？\n注意：关联体验会变成无场景显示。`,
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteScenarioMutation.mutate({ id: scenario.id });
  };

  const handleDeleteExperienceConfig = async (id: number) => {
    const ok = await confirm({
      title: "删除体验配置？",
      description: "确定要删除这个配置吗？",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteExperienceConfig.mutate({ id });
  };

  return (
    <>
      {dialog}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            SMTP邮件配置
          </CardTitle>
          <CardDescription>
            配置邮件服务器，用于发送验证码邮件
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSmtpConfig ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp-host">SMTP服务器地址 *</Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={smtpFormData.host}
                    onChange={(e) => setSmtpFormData({...smtpFormData, host: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp-port">端口 *</Label>
                  <Input
                    id="smtp-port"
                    placeholder="587 或 465"
                    value={smtpFormData.port}
                    onChange={(e) => setSmtpFormData({...smtpFormData, port: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtp-user">用户名/邮箱 *</Label>
                  <Input
                    id="smtp-user"
                    type="email"
                    placeholder="your-email@example.com"
                    value={smtpFormData.user}
                    onChange={(e) => setSmtpFormData({...smtpFormData, user: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp-password">密码 *</Label>
                  <Input
                    id="smtp-password"
                    type="password"
                    placeholder={(smtpConfig as any)?.password ? "已设置（留空不修改）" : "请输入密码"}
                    value={smtpFormData.password}
                    onChange={(e) => setSmtpFormData({...smtpFormData, password: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp-from">发件人邮箱</Label>
                <Input
                  id="smtp-from"
                  type="email"
                  placeholder="noreply@example.com（留空则使用用户名）"
                  value={smtpFormData.from}
                  onChange={(e) => setSmtpFormData({...smtpFormData, from: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <Label>启用状态</Label>
                <Select
                  value={smtpFormData.enabled}
                  onValueChange={(value: "yes" | "no") => setSmtpFormData({...smtpFormData, enabled: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">已启用</SelectItem>
                    <SelectItem value="no">未启用</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => {
                    updateSmtpConfig.mutate(smtpFormData);
                  }}
                  disabled={updateSmtpConfig.isPending}
                  className="gap-2"
                >
                  <Mail className="w-4 h-4" />
                  {updateSmtpConfig.isPending ? "保存中..." : "保存配置"}
                </Button>

                <div className="flex-1 flex gap-2">
                  <Input
                    type="email"
                    placeholder="输入测试邮箱地址"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!testEmail) {
                        alert("请输入测试邮箱地址");
                        return;
                      }
                      testSmtp.mutate({ testEmail });
                    }}
                    disabled={testSmtp.isPending || !smtpFormData.enabled || smtpFormData.enabled === "no"}
                    className="gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {testSmtp.isPending ? "发送中..." : "发送测试邮件"}
                  </Button>
                </div>
              </div>

              {smtpConfig && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  <p>最后更新：{formatDate(smtpConfig.updatedAt)}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 访问限制配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            访问限制配置
          </CardTitle>
          <CardDescription>
            配置未注册用户的每日访问次数限制
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingDailyLimit ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="daily-limit">未注册用户每日访问次数限制</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="daily-limit"
                    type="number"
                    min="0"
                    max="1000"
                    placeholder="10"
                    value={dailyLimit}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value) && value >= 0 && value <= 1000) {
                        setDailyLimit(value);
                      } else if (e.target.value === "") {
                        setDailyLimit(0);
                      }
                    }}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">次/天</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  未注册用户每天最多可以访问体验功能的次数。设置为 0 表示禁止未注册用户访问，必须注册或登录后才能使用。超过限制后，用户需要注册或登录才能继续使用。
                </p>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => {
                    if (dailyLimit < 0 || dailyLimit > 1000) {
                      toast.error("访问限制必须在 0-1000 之间");
                      return;
                    }
                    setDailyLimitMutation.mutate({ limit: dailyLimit });
                  }}
                  disabled={setDailyLimitMutation.isPending || loadingDailyLimit}
                  className="gap-2"
                >
                  <Settings className="w-4 h-4" />
                  {setDailyLimitMutation.isPending ? "保存中..." : "保存配置"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (dailyLimitData?.limit !== undefined) {
                      setDailyLimit(dailyLimitData.limit);
                    }
                  }}
                  disabled={loadingDailyLimit}
                >
                  重置
                </Button>
              </div>

              {dailyLimitData && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  <p>当前限制：{dailyLimitData.limit} 次/天</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 自动封禁 4xx 错误阈值配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            自动封禁配置
          </CardTitle>
          <CardDescription>
            配置 4xx 错误自动封禁阈值
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAutoBlockThreshold ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="auto-block-threshold">自动封禁 4xx 错误阈值</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="auto-block-threshold"
                    type="number"
                    min="1"
                    max="1000"
                    placeholder="30"
                    value={autoBlockThreshold}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value) && value > 0 && value <= 1000) {
                        setAutoBlockThreshold(value);
                      } else if (e.target.value === "") {
                        setAutoBlockThreshold(0);
                      }
                    }}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">个错误/15分钟</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  当某个 IP 在 15 分钟内产生的 4xx 错误数量超过此阈值时，系统会自动将该 IP 添加到黑名单。封禁时长为 24 小时。
                </p>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => {
                    if (autoBlockThreshold < 1 || autoBlockThreshold > 1000) {
                      toast.error("阈值必须在 1-1000 之间");
                      return;
                    }
                    setAutoBlockThresholdMutation.mutate({ threshold: autoBlockThreshold });
                  }}
                  disabled={setAutoBlockThresholdMutation.isPending || loadingAutoBlockThreshold}
                  className="gap-2"
                >
                  <Shield className="w-4 h-4" />
                  {setAutoBlockThresholdMutation.isPending ? "保存中..." : "保存配置"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (autoBlockThresholdData?.threshold !== undefined) {
                      setAutoBlockThreshold(autoBlockThresholdData.threshold);
                    }
                  }}
                  disabled={loadingAutoBlockThreshold}
                >
                  重置
                </Button>
              </div>

              {autoBlockThresholdData && (
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  <p>当前阈值：{autoBlockThresholdData.threshold} 个错误/15分钟</p>
                  <p className="mt-1">说明：当 IP 在 15 分钟内产生超过此数量的 4xx 错误时，将自动加入黑名单 24 小时</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 内部访问白名单配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            内部访问白名单
          </CardTitle>
          <CardDescription>
            每行一个规则：支持完整邮箱（如 alice@huawei.com）或域名规则（如 @huawei.com）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Textarea
              value={internalWhitelistText}
              onChange={(e) => setInternalWhitelistText(e.target.value)}
              rows={8}
              placeholder={"# 每行一个规则\nalice@huawei.com\n@huawei.com"}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => setInternalWhitelistMutation.mutate({ value: internalWhitelistText })}
                disabled={setInternalWhitelistMutation.isPending}
              >
                {setInternalWhitelistMutation.isPending ? "保存中..." : "保存白名单"}
              </Button>
              <Button variant="outline" onClick={() => setInternalWhitelistText(internalWhitelistData?.value || "")}>重置</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              命中白名单的新注册用户默认 access_level=all；未命中默认 public_only。已存在用户请在"注册用户"页手动调整。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* iframe 打开策略配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="w-5 h-5" />
            体验打开方式（不内嵌）
          </CardTitle>
          <CardDescription>
            每行一个 experienceId。命中的体验将直接打开原始 URL，不走 iframe 包裹页。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Textarea
              value={iframeBypassText}
              onChange={(e) => setIframeBypassText(e.target.value)}
              rows={8}
              placeholder={"# 每行一个 experienceId\ninsurance-advisor\nvoice-transfer"}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => setIframeBypassMutation.mutate({ value: iframeBypassText })}
                disabled={setIframeBypassMutation.isPending}
              >
                {setIframeBypassMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
              <Button variant="outline" onClick={() => setIframeBypassText(iframeBypassData?.value || "")}>重置</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              system_config key: <code>iframe_bypass_experience_ids</code>。支持换行或逗号分隔。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 功能开关配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            功能开关
          </CardTitle>
          <CardDescription>
            控制系统中各项功能的开启和关闭
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingFeatureFlags ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : featureFlags && featureFlags.length > 0 ? (
            <div className="space-y-4">
              {featureFlags.map((flag) => (
                <div
                  key={flag.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-base font-medium">{flag.name}</Label>
                      <Badge variant={flag.enabled === "yes" ? "default" : "secondary"}>
                        {flag.enabled === "yes" ? "已启用" : "已禁用"}
                      </Badge>
                    </div>
                    {flag.description && (
                      <p className="text-sm text-muted-foreground mt-1">{flag.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={flag.enabled}
                      onValueChange={(value: "yes" | "no") => {
                        updateFeatureFlag.mutate({
                          key: flag.key,
                          enabled: value,
                        });
                      }}
                      disabled={updateFeatureFlag.isPending}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">启用</SelectItem>
                        <SelectItem value="no">禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              暂无功能开关配置
            </div>
          )}
        </CardContent>
      </Card>

      {/* 场景管理 */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                场景管理
              </CardTitle>
              <CardDescription>
                配置首页场景（新增/编辑/删除），首页按显示顺序自动排布
              </CardDescription>
            </div>
            <Button
              onClick={() => setEditingScenario({
                id: "",
                title: "",
                subtitle: "",
                description: "",
                icon: "",
                displayOrder: (managedScenarios?.length || 0) + 1,
                status: "active",
              })}
              className="gap-2"
            >
              <UserPlus className="w-4 h-4" />
              添加场景
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingScenarios ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : managedScenarios && managedScenarios.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>场景ID</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>副标题</TableHead>
                  <TableHead>图标</TableHead>
                  <TableHead>排序</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-28">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managedScenarios.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <code className="text-xs bg-secondary px-2 py-1 rounded">{s.id}</code>
                    </TableCell>
                    <TableCell>{s.title}</TableCell>
                    <TableCell>{s.subtitle || "-"}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-secondary px-2 py-1 rounded">{s.icon || "-"}</code>
                    </TableCell>
                    <TableCell>{s.displayOrder}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>
                        {s.status === "active" ? "启用" : "隐藏"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingScenario({
                            id: s.id,
                            title: s.title,
                            subtitle: s.subtitle || "",
                            description: s.description || "",
                            icon: s.icon || "",
                            displayOrder: s.displayOrder,
                            status: (s.status || "active") as "active" | "hidden",
                          })}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => { void handleDeleteScenario(s); }}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">暂无场景配置</div>
          )}
        </CardContent>
      </Card>

      {/* 场景体验配置 */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                场景体验配置
              </CardTitle>
              <CardDescription>
                管理场景体验的URL、描述等信息
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => publishRoutesMutation.mutate()}
                disabled={publishRoutesMutation.isPending}
              >
                {publishRoutesMutation.isPending ? "发布中..." : "发布路由"}
              </Button>
              <Button
                onClick={() => {
                  setEditingConfig({
                    experienceId: "",
                    title: "",
                    description: "",
                    url: "",
                    scenarioId: "acquisition",
                    status: "active",
                    visibility: "public",
                    displayOrder: 0,
                    icon: "",
                    tag: "",
                    features: [],
                  });
                }}
                className="gap-2"
              >
                <UserPlus className="w-4 h-4" />
                添加配置
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingExperienceConfigs ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : experienceConfigs && experienceConfigs.length > 0 ? (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>体验ID</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead>图标</TableHead>
                    <TableHead>标签</TableHead>
                    <TableHead>场景</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>发布状态</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>可见性</TableHead>
                    <TableHead>排序</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experienceConfigs.map((config) => {
                    const features = Array.isArray(config.features) ? config.features : (config.features ? JSON.parse(config.features) : []);
                    return (
                      <TableRow key={config.id}>
                      <TableCell className="font-medium">
                        <code className="text-xs bg-secondary px-2 py-1 rounded">
                          {config.experienceId}
                        </code>
                      </TableCell>
                      <TableCell>{config.title}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-secondary px-2 py-1 rounded">
                          {config.icon || "-"}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {config.tag || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {scenarioNameMap[config.scenarioId] || config.scenarioId}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={config.url}>
                        {config.url}
                      </TableCell>
                      <TableCell>
                        {config.publishStatus?.status === "success" ? (
                          <Badge variant="default" className="bg-green-600">✅ 已发布</Badge>
                        ) : config.publishStatus?.status === "failed" ? (
                          <div className="space-y-1">
                            <Badge variant="destructive">❌ 发布失败</Badge>
                            {config.publishStatus?.error ? (
                              <div className="text-xs text-muted-foreground max-w-[220px] truncate" title={config.publishStatus.error}>
                                {config.publishStatus.error}
                              </div>
                            ) : null}
                          </div>
                        ) : config.publishStatus?.status === "running" ? (
                          <Badge variant="secondary">🟡 发布中</Badge>
                        ) : (
                          <Badge variant="outline">未发布</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.status === "active" ? "default" : "secondary"}>
                          {config.status === "active" ? "正常" : "开发中"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.visibility === "internal" ? "destructive" : "outline"}>
                          {config.visibility === "internal" ? "内部" : "公开"}
                        </Badge>
                      </TableCell>
                      <TableCell>{config.displayOrder}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const features = Array.isArray(config.features) ? config.features : (config.features ? JSON.parse(config.features) : []);
                              setEditingConfig({
                                id: config.id,
                                experienceId: config.experienceId,
                                title: config.title,
                                description: config.description || "",
                                url: config.url,
                                scenarioId: config.scenarioId,
                                status: config.status,
                                visibility: (config.visibility || "public") as "public" | "internal",
                                displayOrder: config.displayOrder,
                                icon: config.icon || "",
                                tag: config.tag || "",
                                features: features,
                              });
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { void handleDeleteExperienceConfig(config.id); }}
                            className="text-destructive"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              暂无场景体验配置
            </div>
          )}
        </CardContent>
      </Card>

      {/* 场景编辑对话框 */}
      <Dialog open={editingScenario !== null} onOpenChange={(open) => !open && setEditingScenario(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editingScenario?.id && managedScenarios.some(s => s.id === editingScenario.id) ? "编辑场景" : "新增场景"}</DialogTitle>
            <DialogDescription>配置首页场景信息（标题、副标题、排序、状态等）</DialogDescription>
          </DialogHeader>
          {editingScenario && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>场景ID *</Label>
                  <Input
                    placeholder="例如: risk-control"
                    value={editingScenario.id}
                    onChange={(e) => setEditingScenario({ ...editingScenario, id: e.target.value.trim() })}
                    disabled={managedScenarios.some(s => s.id === editingScenario.id)}
                  />
                  <p className="text-xs text-muted-foreground">唯一标识，创建后不可修改</p>
                </div>
                <div className="space-y-2">
                  <Label>标题 *</Label>
                  <Input
                    placeholder="例如: 数智风控"
                    value={editingScenario.title}
                    onChange={(e) => setEditingScenario({ ...editingScenario, title: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>副标题</Label>
                <Input
                  placeholder="例如: 智能风险识别与预警"
                  value={editingScenario.subtitle}
                  onChange={(e) => setEditingScenario({ ...editingScenario, subtitle: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>描述</Label>
                <Textarea
                  placeholder="输入场景描述..."
                  rows={3}
                  value={editingScenario.description}
                  onChange={(e) => setEditingScenario({ ...editingScenario, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>图标（可手填）</Label>
                  <Input
                    placeholder="例如: Shield"
                    value={editingScenario.icon}
                    onChange={(e) => setEditingScenario({ ...editingScenario, icon: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>显示顺序</Label>
                  <Input
                    type="number"
                    value={editingScenario.displayOrder}
                    onChange={(e) => setEditingScenario({ ...editingScenario, displayOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select
                    value={editingScenario.status}
                    onValueChange={(value: "active" | "hidden") => setEditingScenario({ ...editingScenario, status: value })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="hidden">隐藏</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingScenario(null)}>取消</Button>
            <Button
              onClick={() => {
                if (!editingScenario) return;
                if (!editingScenario.id || !editingScenario.title) {
                  toast.error("请填写场景ID和标题");
                  return;
                }

                const isEdit = managedScenarios.some(s => s.id === editingScenario.id);
                if (isEdit) {
                  updateScenarioMutation.mutate({
                    id: editingScenario.id,
                    title: editingScenario.title,
                    subtitle: editingScenario.subtitle,
                    description: editingScenario.description,
                    icon: editingScenario.icon,
                    displayOrder: editingScenario.displayOrder,
                    status: editingScenario.status,
                  });
                } else {
                  createScenarioMutation.mutate({
                    id: editingScenario.id,
                    title: editingScenario.title,
                    subtitle: editingScenario.subtitle,
                    description: editingScenario.description,
                    icon: editingScenario.icon,
                    displayOrder: editingScenario.displayOrder,
                    status: editingScenario.status,
                  });
                }
              }}
              disabled={createScenarioMutation.isPending || updateScenarioMutation.isPending}
            >
              {createScenarioMutation.isPending || updateScenarioMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 场景体验配置编辑对话框 */}
      <Dialog open={editingConfig !== null} onOpenChange={(open) => !open && setEditingConfig(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingConfig?.id ? "编辑场景体验配置" : "添加场景体验配置"}
            </DialogTitle>
            <DialogDescription>
              配置场景体验的详细信息
            </DialogDescription>
          </DialogHeader>
          {editingConfig && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>体验ID *</Label>
                  <Input
                    placeholder="例如: wealth-assistant"
                    value={editingConfig.experienceId}
                    onChange={(e) => setEditingConfig({ ...editingConfig, experienceId: e.target.value })}
                    disabled={!!editingConfig.id}
                  />
                  <p className="text-xs text-muted-foreground">唯一标识符，创建后不可修改</p>
                </div>
                <div className="space-y-2">
                  <Label>标题 *</Label>
                  <Input
                    placeholder="例如: 银行客户经理财富助手"
                    value={editingConfig.title}
                    onChange={(e) => setEditingConfig({ ...editingConfig, title: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>描述</Label>
                <Textarea
                  placeholder="输入体验的详细描述..."
                  value={editingConfig.description}
                  onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>图标</Label>
                  <Input
                    placeholder="例如: exp-wealth-assistant.png"
                    value={editingConfig.icon}
                    onChange={(e) => setEditingConfig({ ...editingConfig, icon: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">图片文件名</p>
                </div>
                <div className="space-y-2">
                  <Label>标签</Label>
                  <Input
                    placeholder="例如: 财富管理"
                    value={editingConfig.tag}
                    onChange={(e) => setEditingConfig({ ...editingConfig, tag: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>特性列表（每行一个）</Label>
                <Textarea
                  placeholder="例如:&#10;智能资产配置&#10;风险评估&#10;投资建议"
                  value={editingConfig.features.join("\n")}
                  onChange={(e) => setEditingConfig({ ...editingConfig, features: e.target.value.split("\n").filter(f => f.trim()) })}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">每行输入一个特性，会自动转换为数组</p>
              </div>

              <div className="space-y-2">
                <Label>URL地址 *</Label>
                <Input
                  placeholder="http://example.com"
                  value={editingConfig.url}
                  onChange={(e) => setEditingConfig({ ...editingConfig, url: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>所属场景 *</Label>
                  <Select
                    value={editingConfig.scenarioId}
                    onValueChange={(value) => setEditingConfig({ ...editingConfig, scenarioId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {managedScenarios.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                      ))}
                      <SelectItem value="toolbox">智能工具箱</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select
                    value={editingConfig.status}
                    onValueChange={(value: "active" | "developing") => setEditingConfig({ ...editingConfig, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">正常</SelectItem>
                      <SelectItem value="developing">开发中</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>可见性</Label>
                  <Select
                    value={editingConfig.visibility}
                    onValueChange={(value: "public" | "internal") => setEditingConfig({ ...editingConfig, visibility: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">公开</SelectItem>
                      <SelectItem value="internal">内部</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>显示顺序</Label>
                  <Input
                    type="number"
                    value={editingConfig.displayOrder}
                    onChange={(e) => setEditingConfig({ ...editingConfig, displayOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingConfig(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!editingConfig) return;

                if (!editingConfig.experienceId || !editingConfig.title || !editingConfig.url) {
                  toast.error("请填写必填项");
                  return;
                }

                const expId = editingConfig.experienceId.trim();
                const expIdValid = /^(?!-)(?!.*--)[a-z0-9-]{2,50}(?<!-)$/.test(expId);
                if (!expIdValid) {
                  toast.error("体验ID仅支持小写字母/数字/中划线，2-50位，不能以中划线开头或结尾，且不能连续中划线");
                  return;
                }

                if (editingConfig.id) {
                  // 更新
                  updateExperienceConfig.mutate({
                    id: editingConfig.id,
                    title: editingConfig.title,
                    description: editingConfig.description,
                    url: editingConfig.url,
                    scenarioId: editingConfig.scenarioId,
                    status: editingConfig.status,
                    visibility: editingConfig.visibility,
                    displayOrder: editingConfig.displayOrder,
                    icon: editingConfig.icon,
                    tag: editingConfig.tag,
                    features: editingConfig.features,
                  });
                } else {
                  // 创建
                  createExperienceConfig.mutate({
                    experienceId: editingConfig.experienceId,
                    title: editingConfig.title,
                    description: editingConfig.description,
                    url: editingConfig.url,
                    scenarioId: editingConfig.scenarioId,
                    status: editingConfig.status,
                    visibility: editingConfig.visibility,
                    displayOrder: editingConfig.displayOrder,
                    icon: editingConfig.icon,
                    tag: editingConfig.tag,
                    features: editingConfig.features,
                  });
                }
              }}
              disabled={createExperienceConfig.isPending || updateExperienceConfig.isPending}
            >
              {createExperienceConfig.isPending || updateExperienceConfig.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
