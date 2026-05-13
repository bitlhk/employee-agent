import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  recordVisit,
  getAllVisitStats,
  getVisitStatsByScenario,
  getIpAccessStatsByUserType,
  getTopHotExperiences,
  getTopHotExperiencesFromAggregate,
  getHomepagePublicStats,
  getHomepagePublicStatsFromAggregate,
  getVisitStatsByScenarioFromAggregate,
  isStatsReadFromAggregateEnabled,
} from "../db";
import { TEST_MODE } from "./helpers";

export const visitStatsRouter = router({
    // 记录访问
    record: publicProcedure
      .input(z.object({
        registrationId: z.number().int().positive(),
        scenarioId: z.string().min(1).max(50).trim(),
        experienceId: z.string().min(1).max(50).trim(),
        experienceTitle: z.string().min(1).max(200).trim(),
      }))
      .mutation(async ({ input }) => {
        // 测试模式：跳过数据库写入，直接返回成功
        if (TEST_MODE) {
          return { success: true, visitId: Math.floor(Math.random() * 10000) };
        }

        const visitId = await recordVisit({
          registrationId: input.registrationId,
          scenarioId: input.scenarioId,
          experienceId: input.experienceId,
          experienceTitle: input.experienceTitle,
          clickedAt: Date.now(),
        });

        // 注意：已登录用户只记录到 visitStats，不记录到 ipAccessLogs
        // 这样可以避免重复记录，因为 getAllVisitStats 会合并两个表的数据
        // 如果需要查看已登录用户的IP，可以在 visitStats 表中添加 IP 字段，或者单独查询

        return { success: true, visitId };
      }),

    // 获取所有访问记录（分页）
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().positive().optional().default(1),
          pageSize: z.number().int().positive().max(200).optional().default(50),
        }).optional()
      )
      .query(async ({ input }) => {
        // 测试模式：返回空数据
        if (TEST_MODE) {
          return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
        }
        const page = input?.page || 1;
        const pageSize = input?.pageSize || 50;
        return await getAllVisitStats(page, pageSize);
      }),

    // 获取按场景分组的统计
    byScenario: adminProcedure.query(async () => {
      const useAggregate = await isStatsReadFromAggregateEnabled();
      if (useAggregate) {
        return await getVisitStatsByScenarioFromAggregate();
      }
      return await getVisitStatsByScenario();
    }),

    // 获取按场景分组的统计（区分已登录和未登录用户）
    byScenarioWithUserType: adminProcedure.query(async () => {
      const useAggregate = await isStatsReadFromAggregateEnabled();
      if (useAggregate) {
        return await getVisitStatsByScenarioFromAggregate();
      }
      const { getVisitStatsByScenarioWithUserType } = await import("../db");
      return await getVisitStatsByScenarioWithUserType();
    }),

    // 获取IP访问统计（区分已登录和未登录用户）
    ipStats: adminProcedure.query(async () => {
      return await getIpAccessStatsByUserType();
    }),

    // 首页 HOT 应用（最近 N 天 Top K）
    topHot: publicProcedure
      .input(
        z.object({
          days: z.number().int().min(1).max(30).optional().default(5),
          limit: z.number().int().min(1).max(10).optional().default(3),
        }).optional()
      )
      .query(async ({ input }) => {
        const days = input?.days ?? 5;
        const limit = input?.limit ?? 3;
        const useAggregate = await isStatsReadFromAggregateEnabled();
        if (useAggregate) {
          return await getTopHotExperiencesFromAggregate(days, limit);
        }
        return await getTopHotExperiences(days, limit);
      }),

    // 首页公开统计（注册用户数、总访问量）
    publicOverview: publicProcedure.query(async () => {
      const useAggregate = await isStatsReadFromAggregateEnabled();
      if (useAggregate) {
        return await getHomepagePublicStatsFromAggregate();
      }
      return await getHomepagePublicStats();
    }),
});
