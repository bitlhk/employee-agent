/**
 * 员工智能体 - 管理控制台
 * 功能：查看注册用户列表和访问统计数据
 */

import { useState, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  BarChart3,
  ArrowLeft,
  RefreshCw,
  Zap,
  UserPlus,
  MousePointerClick,
  Shield,
  Ban,
  Settings,
  Building2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BizAgentsPanel } from "@/components/BizAgentsPanel";
import { scenarioNames } from "./utils";

import { UsersTab } from "./UsersTab";
import { StatsTab } from "./StatsTab";
import { LogsTab } from "./LogsTab";
import { IpLogsTab } from "./IpLogsTab";
import { SecurityTab } from "./SecurityTab";
import { IpManagementTab } from "./IpManagementTab";
import { SettingsTab } from "./SettingsTab";
import { CollaborationTab } from "./CollaborationTab";

export default function Admin() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("users");
  const { user, logout } = useAuth();

  // Ref for IP management refetch — used by SecurityTab when blocking an IP
  const ipManagementRefetchRef = useRef<(() => void) | null>(null);

  // 获取注册用户列表
  const { data: registrationsData, isLoading: loadingUsers, refetch: refetchUsers } =
    trpc.registration.list.useQuery(undefined, { enabled: activeTab === "users" });

  const registrations = Array.isArray(registrationsData) ? registrationsData : [];

  // 获取按场景分组的统计（包含登录/未登录维度）
  const { data: visitStatsWithUserTypeData, isLoading: loadingStatsWithUserType, refetch: refetchStatsWithUserType } =
    trpc.visitStats.byScenarioWithUserType.useQuery(undefined, { enabled: activeTab === "stats" });

  // 获取按场景分组的统计（旧版本，用于兼容）
  const { data: visitStatsData, isLoading: loadingStats, refetch: refetchStats } =
    trpc.visitStats.byScenario.useQuery(undefined, { enabled: activeTab === "stats" });

  // 后台总览统计（轻量）
  const { data: publicOverviewData } =
    trpc.visitStats.publicOverview.useQuery(undefined, { enabled: activeTab === "users" || activeTab === "stats" });

  const visitStatsWithUserType = Array.isArray(visitStatsWithUserTypeData) ? visitStatsWithUserTypeData : null;
  const visitStats = Array.isArray(visitStatsData) ? visitStatsData : null;

  // 使用新的统计数据（如果可用），否则使用旧的
  const statsToDisplay = Array.isArray(visitStatsWithUserType) ? visitStatsWithUserType : (Array.isArray(visitStats) ? visitStats : []);
  const loadingStatsDisplay = loadingStatsWithUserType || loadingStats;

  // 计算总点击次数
  const totalClicks = useMemo(() => {
    if (visitStatsWithUserType && Array.isArray(visitStatsWithUserType)) {
      return visitStatsWithUserType.reduce((sum, stat) => sum + (stat.total !== undefined ? stat.total : stat.count || 0), 0);
    }
    if (visitStats && Array.isArray(visitStats)) {
      return visitStats.reduce((sum, stat) => sum + stat.count, 0);
    }
    if (publicOverviewData && typeof publicOverviewData.visits === "number") {
      return publicOverviewData.visits;
    }
    return 0;
  }, [visitStatsWithUserType, visitStats, publicOverviewData]);

  // 获取IP访问统计
  const { data: ipStatsData } =
    trpc.visitStats.ipStats.useQuery(undefined, { enabled: activeTab === "stats" });

  const ipStats = Array.isArray(ipStatsData) ? ipStatsData : [];

  // 安全日志统计 — lightweight query for badge count in tab header
  const { data: securityLogsData, refetch: refetchSecurityLogs } =
    trpc.securityLogs.list.useQuery({ page: 1, pageSize: 50 }, { enabled: activeTab === "security" || activeTab === "users" });
  const securityLogs = Array.isArray(securityLogsData?.data) ? securityLogsData.data : [];
  const pendingLogs = securityLogs.filter(log => log.status === "pending");
  const criticalLogs = securityLogs.filter(log => log.severity === "critical" && log.status === "pending");

  // scenarioNameMap — built from stats data (the SettingsTab has its own internal one)
  const scenarioNameMap = useMemo(() => {
    // Use basic scenarioNames; SettingsTab manages its own enriched map internally
    return { ...scenarioNames };
  }, []);

  const handleRefresh = () => {
    refetchUsers();
    refetchStats();
    refetchStatsWithUserType();
    refetchSecurityLogs();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="gap-2 hover:bg-primary/10"
            >
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-lg">管理控制台</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              刷新数据
            </Button>

            {/* 用户菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline">{user?.name || user?.email || "用户"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.name || "未命名用户"}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <p className="text-xs text-muted-foreground">
                      角色: {user?.role === "admin" ? "管理员" : "用户"}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    setLocation("/login");
                  }}
                  className="text-destructive cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 pb-16">
        <div className="container">
          {/* Stats Overview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8"
          >
            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <UserPlus className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">注册用户</p>
                    <p className="text-2xl font-bold">{registrations?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <MousePointerClick className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">总点击次数</p>
                    <p className="text-2xl font-bold">{totalClicks}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <BarChart3 className="w-6 h-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">场景数量</p>
                    <p className="text-2xl font-bold">3</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">体验入口</p>
                    <p className="text-2xl font-bold">6</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">待处理安全事件</p>
                    <p className="text-2xl font-bold">{pendingLogs.length}</p>
                    {criticalLogs.length > 0 && (
                      <p className="text-xs text-red-600 mt-1">
                        {criticalLogs.length} 个严重
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6">
                <TabsTrigger value="users" className="gap-2">
                  <Users className="w-4 h-4" />
                  注册用户
                </TabsTrigger>
                <TabsTrigger value="stats" className="gap-2">
                  <BarChart3 className="w-4 h-4" />
                  访问统计
                </TabsTrigger>
                <TabsTrigger value="logs" className="gap-2">
                  <MousePointerClick className="w-4 h-4" />
                  访问日志
                </TabsTrigger>
                <TabsTrigger value="ip-logs" className="gap-2">
                  <MousePointerClick className="w-4 h-4" />
                  IP访问日志
                </TabsTrigger>
                <TabsTrigger value="security" className="gap-2">
                  <Shield className="w-4 h-4" />
                  安全日志
                  {pendingLogs.length > 0 && (
                    <Badge variant="destructive" className="ml-1">
                      {pendingLogs.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="ip-management" className="gap-2">
                  <Ban className="w-4 h-4" />
                  IP管理
                </TabsTrigger>
                <TabsTrigger value="biz-agents" className="gap-2">
                  <Zap className="w-4 h-4" />
                  业务能力
                </TabsTrigger>
                <TabsTrigger value="collaboration" className="gap-2">
                  <Building2 className="w-4 h-4" />
                  组织协作
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2">
                  <Settings className="w-4 h-4" />
                  设置
                </TabsTrigger>
              </TabsList>

              {/* 注册用户列表 */}
              <TabsContent value="users" className="space-y-6">
                <UsersTab
                  registrations={registrations}
                  loadingUsers={loadingUsers}
                />
              </TabsContent>

              {/* 访问统计 */}
              <TabsContent value="stats">
                <StatsTab
                  statsToDisplay={statsToDisplay}
                  loadingStatsDisplay={loadingStatsDisplay}
                  totalClicks={totalClicks}
                  visitStatsWithUserType={visitStatsWithUserType}
                  scenarioNameMap={scenarioNameMap}
                  ipStatsData={ipStats}
                />
              </TabsContent>

              {/* 访问日志 */}
              <TabsContent value="logs">
                <LogsTab scenarioNameMap={scenarioNameMap} />
              </TabsContent>

              {/* IP访问日志 */}
              <TabsContent value="ip-logs">
                <IpLogsTab scenarioNameMap={scenarioNameMap} />
              </TabsContent>

              {/* 安全日志 */}
              <TabsContent value="security">
                <SecurityTab
                  refetchIpManagement={() => ipManagementRefetchRef.current?.()}
                />
              </TabsContent>

              {/* IP管理 */}
              <TabsContent value="ip-management">
                <IpManagementTab />
              </TabsContent>

              <TabsContent value="biz-agents" className="space-y-4">
                <BizAgentsPanel />
              </TabsContent>

              <TabsContent value="collaboration" className="space-y-4">
                <CollaborationTab />
              </TabsContent>

              <TabsContent value="settings">
                <SettingsTab />
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
