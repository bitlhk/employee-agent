import { router } from "../_core/trpc";
import { systemRouter } from "../_core/systemRouter";
import { authRouter, registrationRouter } from "./auth";
import { visitStatsRouter } from "./stats";
import { securityLogsRouter, ipManagementRouter } from "./security";
import { smtpRouter, featureFlagsRouter, scenariosRouter, experienceConfigsRouter, collabSpacesRouter, collabMembersRouter } from "./admin";
import { clawRouter } from "./claw";
import { ipAccessLogsRouter } from "./ipAccessLogs";
import { systemConfigsRouter } from "./systemConfigs";
import { collabRouter } from "./collab";
import { coopRouter } from "./coop";
import { agentHealthRouter, bizAgentsRouter } from "./agents";
import { auditRouter } from "./audit";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: authRouter,
  registration: registrationRouter,
  visitStats: visitStatsRouter,
  securityLogs: securityLogsRouter,
  ipManagement: ipManagementRouter,
  smtp: smtpRouter,
  featureFlags: featureFlagsRouter,
  scenarios: scenariosRouter,
  experienceConfigs: experienceConfigsRouter,
  collabSpaces: collabSpacesRouter,
  collabMembers: collabMembersRouter,
  claw: clawRouter,
  ipAccessLogs: ipAccessLogsRouter,
  systemConfigs: systemConfigsRouter,
  collab: collabRouter,
  coop: coopRouter,
  agentHealth: agentHealthRouter,
  bizAgents: bizAgentsRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
