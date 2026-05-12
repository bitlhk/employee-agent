import { describe, expect, it } from "vitest";
import {
  normalizeScheduleToolArgs,
  normalizeWeekdays,
} from "./schedule-intent";

describe("normalize schedule tool args", () => {
  it("maps daily time to cron with Chinese display", () => {
    const result = normalizeScheduleToolArgs({
      name: "天气推送",
      prompt: "查询天气并生成简要结果",
      channel: "wechat",
      schedule: { kind: "daily", time: "09:00" },
    }, ["wechat"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule).toEqual({ kind: "cron", cronExpr: "0 9 * * *", display: "每天 09:00" });
      expect(result.value.delivery.targets[0].channelId).toBe("wechat");
    }
  });

  it("maps weekly multi-day schedules", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "发送周报提醒",
      channel: "feishu",
      schedule: { kind: "weekly", time: "08:30", weekdays: ["一三五"] },
    }, ["feishu"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule).toEqual({ kind: "cron", cronExpr: "30 8 * * 1,3,5", display: "每周一、三、五 08:30" });
    }
  });

  it("maps interval schedules", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "检查银行股价",
      channel: "wechat",
      schedule: { kind: "interval", intervalMinutes: 60 },
    }, ["wechat"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule).toEqual({ kind: "interval", intervalMinutes: 60, display: "每 60 分钟" });
    }
  });

  it("maps once schedules", () => {
    const result = normalizeScheduleToolArgs({
      name: "一次提醒",
      prompt: "提醒我准备会议材料",
      channel: "wechat",
      schedule: { kind: "once", runAt: "2026-05-01T09:00:00+08:00" },
    }, ["wechat"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule).toEqual({
        kind: "once",
        runAt: "2026-05-01T09:00:00+08:00",
        display: "2026-05-01T09:00:00+08:00",
      });
    }
  });

  it("asks back when once runAt is missing", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "提醒我准备会议材料",
      channel: "wechat",
      schedule: { kind: "once" },
    }, ["wechat"]);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "missing_time" }));
  });

  it("maps cron passthrough schedules", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "发送月度经营摘要",
      channel: "feishu",
      schedule: { kind: "cron", cronExpr: "0 9 1 * *" },
    }, ["feishu"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule).toEqual({ kind: "cron", cronExpr: "0 9 1 * *", display: "0 9 1 * *" });
    }
  });

  it("rejects interval with non-positive minutes", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "检查银行股价",
      channel: "wechat",
      schedule: { kind: "interval", intervalMinutes: 0 },
    }, ["wechat"]);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "invalid_schedule" }));
  });

  it("asks back when time is missing", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "查询天气",
      channel: "wechat",
      schedule: { kind: "daily" },
    }, ["wechat"]);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "missing_time" }));
  });

  it("asks back when channel is missing", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "查询天气",
      schedule: { kind: "daily", time: "09:00" },
    }, ["wechat"]);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "missing_channel" }));
  });

  it("asks back when requested channel is not bound", () => {
    const result = normalizeScheduleToolArgs({
      prompt: "查询天气",
      channel: "feishu",
      schedule: { kind: "daily", time: "09:00" },
    }, ["wechat"]);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "channel_unbound" }));
  });

  it("normalizes weekday aliases", () => {
    expect(normalizeWeekdays(["mon", "三", "5", "日"])).toEqual([0, 1, 3, 5]);
  });
});
