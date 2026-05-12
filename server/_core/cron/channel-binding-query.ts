import type { ChannelId } from "@shared/types/cron";
import { getFeishuStatus } from "../claw-feishu";
import { getWeixinStatus } from "../claw-weixin";

export type BoundChannel = {
  channelId: ChannelId;
  label: string;
  targetLabel?: string;
};

export async function getBoundChannelsForAdopt(adoptId: string): Promise<BoundChannel[]> {
  const channels: BoundChannel[] = [];

  const wechat = getWeixinStatus(adoptId);
  if (wechat.bound && !wechat.needsReactivation) {
    channels.push({
      channelId: "wechat",
      label: "微信",
      targetLabel: wechat.targetLabel || "微信",
    });
  }

  const feishu = getFeishuStatus(adoptId);
  if (feishu.bound) {
    channels.push({
      channelId: "feishu",
      label: "飞书",
      targetLabel: feishu.targetLabel || "飞书",
    });
  }

  // WeCom is still a placeholder provider.
  return channels;
}

export async function getUserBoundChannels(_userId: number, adoptId?: string): Promise<ChannelId[]> {
  if (!adoptId) return [];
  const channels = await getBoundChannelsForAdopt(adoptId);
  return channels.map((channel) => channel.channelId);
}
