import { describe, expect, it } from "vitest";
import { cleanLeakedToolTags } from "./clean-leaked-tags";

describe("cleanLeakedToolTags", () => {
  it("keeps normal markdown/html tags unchanged", () => {
    const input = "Use <strong>important</strong> text and <br /> safely.";
    expect(cleanLeakedToolTags(input)).toBe(input);
  });

  it("summarizes leaked snake_case tool calls with JSON bodies", () => {
    const input = 'Before <web_search>{"query":"腾讯 Marvis","limit":3}</web_search> after';
    const output = cleanLeakedToolTags(input);
    expect(output).toContain("Before");
    expect(output).toContain("after");
    expect(output).toContain("[工具调用：web search");
    expect(output).toContain("query: 腾讯 Marvis");
    expect(output).not.toContain("<web_search>");
  });

  it("does not rewrite tool-like tags when the body is not JSON", () => {
    const input = "<web_search>not json</web_search>";
    expect(cleanLeakedToolTags(input)).toBe(input);
  });

  it("summarizes self-closing kebab-case tool tags", () => {
    expect(cleanLeakedToolTags("A <browser-navigate /> B")).toBe("A \n\n[工具调用：browser navigate]\n\n B");
  });
});
