import { z } from "zod";
import {
  agentArtifactSchema,
  agentRunResultSchema,
  type AgentArtifact,
  type AgentResult,
  type AgentRunResult,
} from "./agent";

/**
 * Lingxia task workbench template contract.
 *
 * See docs/design/TASK_TEMPLATE_SCHEMA.md and
 * docs/design/TASK_TEMPLATE_RUNNER_DESIGN.md. This shared file intentionally
 * contains schemas and interfaces only; it must not import server routes, DB
 * modules, provider adapters, or UI code.
 */

export const TASK_TEMPLATE_CATEGORIES = [
  "presentation",
  "stock_research",
  "code_development",
  "due_diligence",
  "risk_review",
  "training_material",
  "general",
] as const;
export const taskTemplateCategorySchema = z.enum(TASK_TEMPLATE_CATEGORIES);
export type TaskTemplateCategory = z.infer<typeof taskTemplateCategorySchema>;

export const TASK_STAGE_EXECUTION_MODES = ["single", "parallel"] as const;
export const taskStageExecutionModeSchema = z.enum(TASK_STAGE_EXECUTION_MODES);
export type TaskStageExecutionMode = z.infer<typeof taskStageExecutionModeSchema>;

export const TASK_STAGE_TYPES = ["agent", "source_research", "llm_synthesis"] as const;
export const taskStageTypeSchema = z.enum(TASK_STAGE_TYPES);
export type TaskStageType = z.infer<typeof taskStageTypeSchema>;

export const TASK_STAGE_FAILURE_POLICIES = ["stop", "continue", "partial_success", "retry_once_then_stop"] as const;
export const taskStageFailurePolicySchema = z.enum(TASK_STAGE_FAILURE_POLICIES);
export type TaskStageFailurePolicy = z.infer<typeof taskStageFailurePolicySchema>;

export const TASK_ARTIFACT_TYPES = [
  "markdown_report",
  "ppt_preview",
  "docx_preview",
  "xlsx_table",
  "code_workspace",
  "file_download",
  "summary_artifact",
] as const;
export const taskArtifactTypeSchema = z.enum(TASK_ARTIFACT_TYPES);
export type TaskArtifactType = z.infer<typeof taskArtifactTypeSchema>;

export const TASK_DISCLAIMER_KINDS = [
  "ai_generated_label",
  "investment_advisory",
  "code_review_required",
  "fact_check_required",
] as const;
export const taskDisclaimerKindSchema = z.enum(TASK_DISCLAIMER_KINDS);
export type DisclaimerKind = z.infer<typeof taskDisclaimerKindSchema>;

export const taskInputMappingSchema = z.object({
  original: z.boolean().optional(),
  fromStages: z.array(z.string().min(1)).optional(),
  fromArtifacts: z.array(z.object({
    stageId: z.string().min(1),
    artifactType: z.string().min(1).optional(),
  })).optional(),
}).superRefine((mapping, ctx) => {
  const hasOriginal = mapping.original === true;
  const hasStages = Boolean(mapping.fromStages?.length);
  const hasArtifacts = Boolean(mapping.fromArtifacts?.length);
  if (!hasOriginal && !hasStages && !hasArtifacts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "inputMapping must reference original or fromStages or fromArtifacts",
    });
  }
});
export type TaskInputMapping = z.infer<typeof taskInputMappingSchema>;

export const taskStageSchema = z.object({
  id: z.string().min(1),
  stageType: taskStageTypeSchema.optional(),
  displayName: z.string().min(1),
  personaId: z.string().min(1),
  agentDefinitionId: z.string().min(1),
  executionMode: taskStageExecutionModeSchema,
  inputMapping: taskInputMappingSchema,
  expectedOutputs: z.array(taskArtifactTypeSchema).min(1),
  timeoutMs: z.number().int().positive(),
  onFailure: taskStageFailurePolicySchema,
});
export type TaskStage = z.infer<typeof taskStageSchema>;

export const taskOutputPolicySchema = z.object({
  allowedArtifactTypes: z.array(taskArtifactTypeSchema).min(1),
  disclaimers: z.array(taskDisclaimerKindSchema),
  citationRequired: z.boolean().optional(),
  saveToWorkspaceDefault: z.literal(false).optional(),
}).superRefine((policy, ctx) => {
  if (!policy.disclaimers.includes("ai_generated_label")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["disclaimers"],
      message: "ai_generated_label disclaimer is required",
    });
  }
});
export type TaskOutputPolicy = z.infer<typeof taskOutputPolicySchema>;

export const taskTemplateSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "deprecated"]),
  displayName: z.string().min(1),
  shortDescription: z.string().min(1),
  category: taskTemplateCategorySchema,
  estimatedDurationMs: z.number().int().positive(),
  maxDurationMs: z.number().int().positive().optional(),
  stages: z.array(taskStageSchema).min(1),
  outputPolicy: taskOutputPolicySchema,
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  updatedBy: z.number().int().positive().optional(),
});
export type TaskTemplate = z.infer<typeof taskTemplateSchema>;

export const agentCitationSchema = z.object({
  id: z.string().min(1),
  sourceAgentDefinitionId: z.string().min(1).optional(),
  sourceRunResultId: z.string().min(1).optional(),
  sourceStageId: z.string().min(1).optional(),
  excerpt: z.string().min(1).max(240),
  externalUrl: z.string().min(1).optional(),
  externalTitle: z.string().min(1).optional(),
});
export type AgentCitation = z.infer<typeof agentCitationSchema>;

export const taskTemplateRunSnapshotSchema = z.object({
  taskTemplateId: z.string().min(1),
  taskTemplateVersion: z.number().int().positive(),
  taskTemplateName: z.string().min(1),
  chainHash: z.string().min(1),
  stageSnapshots: z.array(z.object({
    stageId: z.string().min(1),
    stageType: taskStageTypeSchema.optional(),
    personaId: z.string().min(1),
    agentDefinitionId: z.string().min(1),
    inputMapping: taskInputMappingSchema,
    timeoutMs: z.number().int().positive(),
    onFailure: taskStageFailurePolicySchema,
  })),
});
export type TaskTemplateRunSnapshot = z.infer<typeof taskTemplateRunSnapshotSchema>;

export const taskStageRunResultSchema = z.object({
  stageId: z.string().min(1),
  personaId: z.string().min(1),
  agentDefinitionId: z.string().min(1),
  status: z.enum(["success", "failed", "skipped", "timeout"]),
  runResult: agentRunResultSchema.optional(),
  durationMs: z.number().int().nonnegative(),
  artifacts: z.array(agentArtifactSchema),
  ownCitations: z.array(agentCitationSchema).optional(),
  upstreamCitations: z.array(agentCitationSchema).optional(),
  warnings: z.array(z.string()).optional(),
});
export type TaskStageRunResult = z.infer<typeof taskStageRunResultSchema>;

export const taskRunResultSchema = z.object({
  taskRunId: z.string().min(1),
  taskTemplateId: z.string().min(1),
  taskTemplateVersion: z.number().int().positive(),
  taskTemplateChainHash: z.string().min(1),
  status: z.enum(["completed", "partial_success", "failed", "timeout", "cancelled"]),
  stages: z.array(taskStageRunResultSchema),
  artifacts: z.array(agentArtifactSchema),
  upstreamCitations: z.array(agentCitationSchema).optional(),
  disclaimers: z.array(taskDisclaimerKindSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  runtimeSnapshotJson: taskTemplateRunSnapshotSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
});
export type TaskRunResult = z.infer<typeof taskRunResultSchema>;

export interface TaskTemplateRunner {
  loadTemplate(templateId: string): Promise<AgentResult<TaskTemplate>>;
  runTask(input: {
    template: TaskTemplate;
    userInput: string;
    context: {
      userId: number;
      adoptId: string;
      spaceId?: number | null;
      metadata?: Record<string, unknown>;
    };
  }): Promise<AgentResult<TaskRunResult>>;
}

export function taskArtifactKindFor(artifact: AgentArtifact): TaskArtifactType {
  switch (artifact.type) {
    case "markdown":
      return "markdown_report";
    case "pptx":
      return "ppt_preview";
    case "xlsx":
      return "xlsx_table";
    case "code":
      return "code_workspace";
    case "pdf":
    case "html":
    case "image":
    case "zip":
    case "file":
      return "file_download";
  }
}

export function withTaskRunMetadata(result: AgentRunResult, metadata: Record<string, unknown>): AgentRunResult {
  return {
    ...result,
    metadata: {
      ...(result.metadata || {}),
      ...metadata,
    },
  };
}
