import { describe, it, expect } from "vitest";
import {
  parseAdoptId, parseRelPath, parseFileName, parseMemoryTarget,
  parseTtl, parseWriteMode, parseNonEmptyString, parsePositiveInt,
  SchemaError, ApiError
} from "./schemas";

describe("parseAdoptId", () => {
  it("accepts valid adoptId", () => {
    expect(parseAdoptId("lgc-abc123")).toBe("lgc-abc123");
    expect(parseAdoptId("test_agent-1")).toBe("test_agent-1");
  });
  it("rejects empty", () => {
    expect(() => parseAdoptId("")).toThrow(SchemaError);
    expect(() => parseAdoptId(null)).toThrow(SchemaError);
  });
  it("rejects special chars", () => {
    expect(() => parseAdoptId("../etc")).toThrow(SchemaError);
    expect(() => parseAdoptId("foo bar")).toThrow(SchemaError);
    expect(() => parseAdoptId("a/b")).toThrow(SchemaError);
  });
});

describe("parseRelPath", () => {
  it("accepts normal path", () => {
    expect(parseRelPath("foo/bar.txt")).toBe("foo/bar.txt");
  });
  it("cleans traversal", () => {
    expect(parseRelPath("../../etc/passwd")).toBe("etc/passwd");
  });
  it("rejects empty", () => {
    expect(() => parseRelPath("")).toThrow(SchemaError);
  });
});

describe("parseFileName", () => {
  it("accepts normal filename", () => {
    expect(parseFileName("report.pdf")).toBe("report.pdf");
  });
  it("rejects traversal", () => {
    expect(() => parseFileName("../etc/passwd")).toThrow(SchemaError);
  });
  it("rejects path separator", () => {
    expect(() => parseFileName("foo/bar")).toThrow(SchemaError);
  });
});

describe("parseMemoryTarget", () => {
  it("accepts MEMORY.md", () => {
    const r = parseMemoryTarget("MEMORY.md");
    expect(r.type).toBe("memory");
  });
  it("accepts daily format", () => {
    const r = parseMemoryTarget("memory:2026-04-08");
    expect(r.type).toBe("daily");
  });
  it("accepts notes", () => {
    const r = parseMemoryTarget("notes:todo.md");
    expect(r.type).toBe("notes");
  });
  it("rejects arbitrary path", () => {
    expect(() => parseMemoryTarget("../../etc/passwd")).toThrow(SchemaError);
    expect(() => parseMemoryTarget("random.txt")).toThrow(SchemaError);
  });
  it("rejects empty", () => {
    expect(() => parseMemoryTarget("")).toThrow(SchemaError);
  });
});

describe("parseTtl", () => {
  it("returns value for valid input", () => {
    expect(parseTtl(3600)).toBe(3600);
  });
  it("returns default for null/undefined", () => {
    expect(parseTtl(null)).toBe(1800);
    expect(parseTtl(undefined)).toBe(1800);
  });
  it("returns default for invalid", () => {
    expect(parseTtl("abc")).toBe(1800);
    expect(parseTtl(-1)).toBe(1800);
  });
});

describe("parseWriteMode", () => {
  it("accepts append/replace", () => {
    expect(parseWriteMode("append")).toBe("append");
    expect(parseWriteMode("replace")).toBe("replace");
  });
  it("rejects invalid", () => {
    expect(() => parseWriteMode("delete")).toThrow(SchemaError);
  });
  it("defaults to append", () => {
    expect(parseWriteMode(undefined)).toBe("append");
  });
});

describe("parseNonEmptyString", () => {
  it("trims and returns", () => {
    expect(parseNonEmptyString("  hello  ")).toBe("hello");
  });
  it("rejects empty", () => {
    expect(() => parseNonEmptyString("")).toThrow(SchemaError);
    expect(() => parseNonEmptyString("   ")).toThrow(SchemaError);
  });
});

describe("parsePositiveInt", () => {
  it("accepts positive int", () => {
    expect(parsePositiveInt(42)).toBe(42);
    expect(parsePositiveInt("10")).toBe(10);
  });
  it("rejects zero/negative/float", () => {
    expect(() => parsePositiveInt(0)).toThrow(SchemaError);
    expect(() => parsePositiveInt(-1)).toThrow(SchemaError);
    expect(() => parsePositiveInt(3.14)).toThrow(SchemaError);
  });
});


describe("ApiError contract", () => {
  it("SchemaError 是 ApiError 的别名", () => {
    // ApiError and SchemaError already imported at top
    expect(SchemaError).toBe(ApiError);
  });

  it("ApiError 包含 code 和 status", () => {
    const e = new ApiError("NOT_FOUND", "file not found");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.status).toBe(404);
    expect(e.message).toBe("file not found");
  });

  it("ApiError 支持 details", () => {
    const e = new ApiError("BAD_REQUEST", "invalid", { field: "adoptId" });
    expect(e.details).toEqual({ field: "adoptId" });
  });

  it("各 code 对应正确 status", () => {
    // ApiError already imported at top
    expect(new ApiError("BAD_REQUEST", "").status).toBe(400);
    expect(new ApiError("UNAUTHORIZED", "").status).toBe(401);
    expect(new ApiError("FORBIDDEN", "").status).toBe(403);
    expect(new ApiError("NOT_FOUND", "").status).toBe(404);
    expect(new ApiError("CONFLICT", "").status).toBe(409);
    expect(new ApiError("RATE_LIMITED", "").status).toBe(429);
    expect(new ApiError("PAYLOAD_TOO_LARGE", "").status).toBe(413);
    expect(new ApiError("INTERNAL_ERROR", "").status).toBe(500);
  });
});
