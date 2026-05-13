import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { scenarioIcons, scenarioColors } from "./utils";

interface StatsTabProps {
  statsToDisplay: any[];
  loadingStatsDisplay: boolean;
  totalClicks: number;
  visitStatsWithUserType: any[] | null;
  scenarioNameMap: Record<string, string>;
  ipStatsData: any[];
}

export function StatsTab({
  statsToDisplay,
  loadingStatsDisplay,
  totalClicks,
  visitStatsWithUserType,
  scenarioNameMap,
}: StatsTabProps) {
  return (
    <div className="grid gap-6">
      {/* 场景统计卡片 */}
      <div className="grid md:grid-cols-3 gap-4">
        {Array.isArray(statsToDisplay) && statsToDisplay.map((stat) => {
          const Icon = scenarioIcons[stat.scenarioId] || BarChart3;
          const color = scenarioColors[stat.scenarioId] || "bg-gray-500";
          const totalCount = (stat as any).total !== undefined ? (stat as any).total : stat.count;
          const loggedInCount = (stat as any).loggedIn || 0;
          const unloggedCount = (stat as any).unlogged || 0;
          return (
            <Card key={stat.scenarioId} className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">
                      {scenarioNameMap[stat.scenarioId] || stat.scenarioId}
                    </CardTitle>
                    <CardDescription className="space-y-1">
                      <div>总点击: <span className="font-semibold">{totalCount}</span> 次</div>
                      {visitStatsWithUserType && (
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-green-600">已登录: {loggedInCount}</span>
                          <span className="text-orange-600">未登录: {unloggedCount}</span>
                        </div>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stat.experiences.map((exp: any) => {
                    const expTotal = exp.total !== undefined ? exp.total : exp.count;
                    const expLoggedIn = exp.loggedIn || 0;
                    const expUnlogged = exp.unlogged || 0;
                    return (
                      <div
                        key={exp.experienceId}
                        className="p-2 bg-secondary/50 rounded-lg space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm truncate flex-1">{exp.title || exp.experienceId}</span>
                          <span className="text-sm font-medium ml-2">{expTotal} 次</span>
                        </div>
                        {visitStatsWithUserType && (
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="text-green-600">已登录: {expLoggedIn}</span>
                            <span className="text-orange-600">未登录: {expUnlogged}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 统计图表 */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>场景点击分布</CardTitle>
          <CardDescription>各场景的点击次数对比</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingStatsDisplay ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : Array.isArray(statsToDisplay) && statsToDisplay.length > 0 ? (
            <div className="space-y-4">
              {statsToDisplay.map((stat) => {
                const statTotal = (stat as any).total !== undefined ? (stat as any).total : stat.count;
                const percentage = totalClicks > 0
                  ? Math.round((statTotal / totalClicks) * 100)
                  : 0;
                const color = scenarioColors[stat.scenarioId] || "bg-gray-500";
                const loggedInCount = (stat as any).loggedIn || 0;
                const unloggedCount = (stat as any).unlogged || 0;
                return (
                  <div key={stat.scenarioId} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {scenarioNameMap[stat.scenarioId] || stat.scenarioId}
                      </span>
                      <span className="text-muted-foreground">
                        {statTotal} 次 ({percentage}%)
                      </span>
                    </div>
                    {visitStatsWithUserType && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1">
                        <span className="text-green-600">已登录: {loggedInCount}</span>
                        <span className="text-orange-600">未登录: {unloggedCount}</span>
                      </div>
                    )}
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className={`h-full ${color} rounded-full`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              暂无访问统计数据
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
