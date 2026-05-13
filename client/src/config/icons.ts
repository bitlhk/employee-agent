import { Sparkles, Brain, MessageCircle, Settings2 } from "lucide-react";

export const sidebarIconMap = {
  skills: Sparkles,
  memory: Brain,
  session: MessageCircle,
  soul: Settings2,
} as const;

export type SidebarIconKey = keyof typeof sidebarIconMap;
