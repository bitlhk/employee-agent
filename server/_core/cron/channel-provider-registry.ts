import type { ChannelId, ChannelProvider } from "@shared/types/cron";
import { FeishuChannelProvider, WechatChannelProvider, WecomChannelProvider } from "./channel-providers";

const providers = new Map<ChannelId, ChannelProvider>([
  ["wechat", new WechatChannelProvider()],
  ["feishu", new FeishuChannelProvider()],
  ["wecom", new WecomChannelProvider()],
]);

const CHANNEL_ALIASES: Record<string, ChannelId> = {
  weixin: "wechat",
  wechat: "wechat",
  feishu: "feishu",
  wecom: "wecom",
};

export function normalizeChannelId(channel: string): ChannelId | undefined {
  return CHANNEL_ALIASES[String(channel || "").trim().toLowerCase()];
}

export function getChannelProvider(channel: string): ChannelProvider | undefined {
  const channelId = normalizeChannelId(channel);
  return channelId ? providers.get(channelId) : undefined;
}

export function listChannelProviders(): ChannelProvider[] {
  return Array.from(providers.values());
}
