export const formatDate = (date: Date | string) => {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
  });
};

// 场景名称映射
export const scenarioNames: Record<string, string> = {
  acquisition: "获客增收",
  operations: "运营提效",
  investment: "投资获利",
  "risk-control": "数智风控"
};

// 场景图标映射 — imported icons are re-exported from here
import { Users, Zap, TrendingUp, Shield } from "lucide-react";

export const scenarioIcons: Record<string, React.ElementType> = {
  acquisition: Users,
  operations: Zap,
  investment: TrendingUp,
  "risk-control": Shield
};

// 场景颜色映射
export const scenarioColors: Record<string, string> = {
  acquisition: "bg-red-500",
  operations: "bg-blue-500",
  investment: "bg-green-500",
  "risk-control": "bg-purple-500"
};
