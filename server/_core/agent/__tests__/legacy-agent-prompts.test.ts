import { describe, expect, it } from "vitest";
import { resolveLegacyBusinessAgentSystemPrompt } from "../providers/legacy-agent-prompts";

describe("legacy business agent prompts", () => {
  it("keeps Jianye aligned with the product PPT quality standard", () => {
    const prompt = resolveLegacyBusinessAgentSystemPrompt("task-ppt");

    expect(prompt).toContain("【好 PPT 的质量标准】");
    expect(prompt).toContain("每页标题必须是清晰观点");
    expect(prompt).toContain("标题前必须加四字概述标签");
    expect(prompt).toContain("3-4 条精炼证据");
    expect(prompt).toContain("Markdown 表格");
    expect(prompt).toContain("AS-IS / TO-BE");
  });
});
