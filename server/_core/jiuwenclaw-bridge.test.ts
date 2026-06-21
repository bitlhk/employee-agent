import { describe, expect, it } from "vitest";
import { inferMcpServerForJiuwenTool, inferSkillIdFromJiuwenPayload } from "./jiuwenclaw-bridge";

describe("jiuwenclaw bridge audit helpers", () => {
  it("maps business tool names to MCP server ids", () => {
    expect(inferMcpServerForJiuwenTool("wealth_assistant_customer_list")).toBe("wealth_assistant_customer");
    expect(inferMcpServerForJiuwenTool("wealth_assistant_product_search")).toBe("wealth_assistant_product");
    expect(inferMcpServerForJiuwenTool("qieman_fund_search")).toBe("qieman");
    expect(inferMcpServerForJiuwenTool("get_stock_quote")).toBe("wind_stock_data");
    expect(inferMcpServerForJiuwenTool("get_company_announcements")).toBe("wind_financial_docs");
  });

  it("does not classify unknown runtime tools as MCP business tools", () => {
    expect(inferMcpServerForJiuwenTool("execute_cmd")).toBeNull();
    expect(inferMcpServerForJiuwenTool("read_file")).toBeNull();
  });

  it("infers skill ids from jiuwenswarm tool arguments", () => {
    expect(inferSkillIdFromJiuwenPayload({ command: "python skills/wealth-manager-assistant/run.py" })).toBe("wealth-manager-assistant");
    expect(inferSkillIdFromJiuwenPayload({ skillId: "insurance-advisor-pro" })).toBe("insurance-advisor-pro");
  });
});
