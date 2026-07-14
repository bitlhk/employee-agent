import { describe, expect, it } from "vitest";
import { deriveScheduleTaskFromMessage, routeMessage } from "./intent-agent";
import type { StreamWriter } from "./stream-writer";

function createWriter(): StreamWriter {
  return {
    ended: false,
    writeText: () => {},
    writeRaw: () => {},
    writeEnd: () => {},
    writeError: () => {},
  };
}

describe("deriveScheduleTaskFromMessage", () => {
  it("preserves weather city when building scheduled weather prompts", () => {
    expect(deriveScheduleTaskFromMessage("每天早上9点微信推送北京天气")).toBe("查询北京天气并生成简要结果");
    expect(deriveScheduleTaskFromMessage("每日9点发到飞书广州天气")).toBe("查询广州天气并生成简要结果");
  });

  it("falls back to generic weather only when the city is absent", () => {
    expect(deriveScheduleTaskFromMessage("每天早上9点微信推送天气")).toBe("查询天气并生成简要结果");
  });

  it("keeps non-weather schedule task content readable", () => {
    expect(deriveScheduleTaskFromMessage("每天8点半，给我整理并推送下当天人工智能的热点新闻，重点关注模型，智能体，算力基础设施部分的"))
      .toBe("整理当天人工智能的热点新闻重点关注模型智能体算力基础设施部分的");
  });
});

describe("intent agent schedule passthrough", () => {
  it("does not create schedules for policy questions that mention a daily time", async () => {
    const handled = await routeMessage(
      "lgc-ppstsl9ddr",
      "你搜下 北京现在有线上的电脑补贴吗？是每天10点发 还是 现在只有线下的？",
      createWriter(),
    );
    expect(handled).toBe(false);
  });

  it("passes explicit schedule creation requests through to OpenClaw", async () => {
    const handled = await routeMessage(
      "lgc-ppstsl9ddr",
      "每天上午10点查询北京天气并发到微信",
      createWriter(),
    );
    expect(handled).toBe(false);
  });
});
