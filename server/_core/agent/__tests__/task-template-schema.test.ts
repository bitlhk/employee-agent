import { describe, expect, it } from "vitest";
import {
  taskInputMappingSchema,
  taskStageSchema,
  taskTemplateSchema,
} from "../../../../shared/types/task-template";

function baseTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "ppt_report_writing",
    version: 1,
    status: "active",
    displayName: "PPT 汇报写作",
    shortDescription: "将主题或材料整理成结构化演示文稿草稿。",
    category: "presentation",
    estimatedDurationMs: 90000,
    maxDurationMs: 300000,
    stages: [
      {
        id: "ppt_generation",
        displayName: "生成演示文稿",
        personaId: "jianye",
        agentDefinitionId: "task-ppt",
        executionMode: "single",
        inputMapping: { original: true },
        expectedOutputs: ["ppt_preview", "markdown_report"],
        timeoutMs: 300000,
        onFailure: "retry_once_then_stop",
      },
    ],
    outputPolicy: {
      allowedArtifactTypes: ["ppt_preview", "markdown_report", "file_download"],
      disclaimers: ["ai_generated_label", "fact_check_required"],
      citationRequired: false,
      saveToWorkspaceDefault: false,
    },
    ...overrides,
  };
}

describe("task template shared schemas", () => {
  it("accepts a complete valid V1 PPT template", () => {
    expect(taskTemplateSchema.safeParse(baseTemplate()).success).toBe(true);
  });

  it("rejects templates missing version", () => {
    const { version, ...value } = baseTemplate();
    expect(taskTemplateSchema.safeParse(value).success).toBe(false);
  });

  it("requires ai_generated_label disclaimer", () => {
    expect(taskTemplateSchema.safeParse(baseTemplate({
      outputPolicy: {
        allowedArtifactTypes: ["markdown_report"],
        disclaimers: ["fact_check_required"],
      },
    })).success).toBe(false);
  });

  it("rejects empty inputMapping", () => {
    expect(taskInputMappingSchema.safeParse({}).success).toBe(false);
  });

  it("accepts original inputMapping", () => {
    expect(taskInputMappingSchema.safeParse({ original: true }).success).toBe(true);
  });

  it("accepts fromStages inputMapping", () => {
    expect(taskInputMappingSchema.safeParse({ fromStages: ["research"] }).success).toBe(true);
  });

  it("rejects templates without stages", () => {
    expect(taskTemplateSchema.safeParse(baseTemplate({ stages: [] })).success).toBe(false);
  });

  it("rejects output policies without allowed artifact types", () => {
    expect(taskTemplateSchema.safeParse(baseTemplate({
      outputPolicy: {
        allowedArtifactTypes: [],
        disclaimers: ["ai_generated_label"],
      },
    })).success).toBe(false);
  });

  it("rejects invalid onFailure values", () => {
    expect(taskStageSchema.safeParse({
      id: "s1",
      displayName: "Stage",
      personaId: "p1",
      agentDefinitionId: "a1",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 1000,
      onFailure: "retry_forever",
    }).success).toBe(false);
  });

  it("rejects invalid executionMode values", () => {
    expect(taskStageSchema.safeParse({
      id: "s1",
      displayName: "Stage",
      personaId: "p1",
      agentDefinitionId: "a1",
      executionMode: "dag",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 1000,
      onFailure: "stop",
    }).success).toBe(false);
  });

  it("accepts source_research stageType", () => {
    expect(taskStageSchema.safeParse({
      id: "source",
      stageType: "source_research",
      displayName: "Source research",
      personaId: "wenzhou",
      agentDefinitionId: "wenzhou-source-research",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 1000,
      onFailure: "stop",
    }).success).toBe(true);
  });

  it("rejects invalid stageType values", () => {
    expect(taskStageSchema.safeParse({
      id: "source",
      stageType: "browser_agent",
      displayName: "Source research",
      personaId: "wenzhou",
      agentDefinitionId: "wenzhou-source-research",
      executionMode: "single",
      inputMapping: { original: true },
      expectedOutputs: ["markdown_report"],
      timeoutMs: 1000,
      onFailure: "stop",
    }).success).toBe(false);
  });
});
