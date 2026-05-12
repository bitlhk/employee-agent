import type { ChannelId, CronDeliveryConfig, CronSchedule } from "@shared/types/cron";

export type ScheduleIntentKind = "daily" | "weekly" | "once" | "interval" | "cron";

export type ScheduleToolSchedule = {
  kind?: ScheduleIntentKind;
  time?: string;
  weekdays?: string[];
  runAt?: string;
  intervalMinutes?: number;
  cronExpr?: string;
};

export type ScheduleToolArgsV2 = {
  name?: string;
  prompt?: string;
  task?: string;
  schedule?: ScheduleToolSchedule;
  channel?: ChannelId | string;
};

export type NormalizedScheduleIntent =
  | {
      ok: true;
      value: {
        name: string;
        prompt: string;
        schedule: CronSchedule;
        delivery: CronDeliveryConfig;
        channel: ChannelId;
      };
    }
  | { ok: false; question: string; reason: "missing_prompt" | "missing_time" | "missing_channel" | "channel_unbound" | "invalid_schedule" };

const CHANNEL_LABEL: Record<ChannelId, string> = {
  wechat: "微信",
  feishu: "飞书",
  wecom: "企业微信",
};

const WEEKDAY_ALIASES: Record<string, number> = {
  "0": 0,
  "7": 0,
  sun: 0,
  sunday: 0,
  日: 0,
  天: 0,
  "1": 1,
  mon: 1,
  monday: 1,
  一: 1,
  "2": 2,
  tue: 2,
  tuesday: 2,
  二: 2,
  "3": 3,
  wed: 3,
  wednesday: 3,
  三: 3,
  "4": 4,
  thu: 4,
  thursday: 4,
  四: 4,
  "5": 5,
  fri: 5,
  friday: 5,
  五: 5,
  "6": 6,
  sat: 6,
  saturday: 6,
  六: 6,
};

const WEEKDAY_DISPLAY: Record<number, string> = {
  0: "日",
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
};

export function normalizeChannelId(value?: string): ChannelId | undefined {
  const v = String(value || "").toLowerCase();
  if (v === "wechat" || v === "weixin" || v === "微信") return "wechat";
  if (v === "feishu" || v === "飞书") return "feishu";
  if (v === "wecom" || v === "企微" || v === "企业微信") return "wecom";
  return undefined;
}

export function normalizeTime(value?: string): string | undefined {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeWeekdays(values?: string[]): number[] {
  const out = new Set<number>();
  for (const item of values || []) {
    const chars = String(item).trim();
    if (WEEKDAY_ALIASES[chars] !== undefined) {
      out.add(WEEKDAY_ALIASES[chars]);
      continue;
    }
    for (const ch of chars) {
      if (WEEKDAY_ALIASES[ch] !== undefined) out.add(WEEKDAY_ALIASES[ch]);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function fallbackName(prompt: string) {
  const compact = prompt.replace(/\s+/g, "").slice(0, 10);
  return compact ? `${compact}定时任务` : "定时任务";
}

export function normalizeScheduleToolArgs(args: ScheduleToolArgsV2, boundChannels: ChannelId[]): NormalizedScheduleIntent {
  const prompt = String(args.prompt || args.task || "").trim();
  if (!prompt) {
    return { ok: false, reason: "missing_prompt", question: "你希望这个定时任务具体做什么？比如“查询天气并发给我”。" };
  }

  const channel = normalizeChannelId(args.channel);
  if (!channel) {
    return { ok: false, reason: "missing_channel", question: "你想把结果发到哪个频道？可以说“发到微信”或“发到飞书”。" };
  }
  if (!boundChannels.includes(channel)) {
    return { ok: false, reason: "channel_unbound", question: `${CHANNEL_LABEL[channel]}还没有绑定。请先在侧边栏「频道」里绑定${CHANNEL_LABEL[channel]}，再创建定时任务。` };
  }

  const scheduleInput = args.schedule || {};
  const kind = scheduleInput.kind;
  let schedule: CronSchedule | undefined;

  if (kind === "daily") {
    const time = normalizeTime(scheduleInput.time);
    if (!time) return { ok: false, reason: "missing_time", question: "你想每天几点发送？例如“每天 09:00 发到微信”。" };
    const [hour, minute] = time.split(":").map(Number);
    schedule = { kind: "cron", cronExpr: `${minute} ${hour} * * *`, display: `每天 ${time}` };
  } else if (kind === "weekly") {
    const time = normalizeTime(scheduleInput.time);
    if (!time) return { ok: false, reason: "missing_time", question: "你想每周几点发送？例如“每周一三五 09:00 发到微信”。" };
    const weekdays = normalizeWeekdays(scheduleInput.weekdays);
    if (weekdays.length === 0) return { ok: false, reason: "invalid_schedule", question: "你想每周几发送？例如“每周一”或“每周一三五”。" };
    const [hour, minute] = time.split(":").map(Number);
    const cronDays = weekdays.join(",");
    const labelDays = weekdays.map((day) => WEEKDAY_DISPLAY[day]).join("、");
    schedule = { kind: "cron", cronExpr: `${minute} ${hour} * * ${cronDays}`, display: `每周${labelDays} ${time}` };
  } else if (kind === "once") {
    const runAt = String(scheduleInput.runAt || "").trim();
    if (!runAt) return { ok: false, reason: "missing_time", question: "你想具体哪一天、几点执行？例如“明天下午 3 点”。" };
    schedule = { kind: "once", runAt, display: runAt };
  } else if (kind === "interval") {
    const intervalMinutes = Number(scheduleInput.intervalMinutes || 0);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return { ok: false, reason: "invalid_schedule", question: "你想每隔多久执行一次？例如“每隔 60 分钟”。" };
    schedule = { kind: "interval", intervalMinutes, display: `每 ${intervalMinutes} 分钟` };
  } else if (kind === "cron") {
    const cronExpr = String(scheduleInput.cronExpr || "").trim();
    if (!cronExpr) return { ok: false, reason: "invalid_schedule", question: "请提供 cron 表达式，例如 `0 9 * * *`。" };
    schedule = { kind: "cron", cronExpr, display: cronExpr };
  }

  if (!schedule) {
    return { ok: false, reason: "invalid_schedule", question: "你想怎么定时？可以说“每天 9 点”“每周一 8 点”或“每隔 60 分钟”。" };
  }

  return {
    ok: true,
    value: {
      name: String(args.name || "").trim() || fallbackName(prompt),
      prompt,
      schedule,
      channel,
      delivery: {
        targets: [{
          channelId: channel,
          channelLabel: CHANNEL_LABEL[channel],
        }],
      },
    },
  };
}
