import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getClientIp } from "../_core/ip-utils";

export const ipAccessLogsRouter = router({
    // 获取所有IP访问记录（分页）
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().positive().optional().default(1),
          pageSize: z.number().int().positive().max(200).optional().default(50),
          ip: z.string().max(45).optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const { getAllIpAccessLogs, getIpAccessLogsByIp } = await import("../db");
        const page = input?.page || 1;
        const pageSize = input?.pageSize || 50;

        if (input?.ip) {
          return await getIpAccessLogsByIp(input.ip, page, pageSize);
        }
        return await getAllIpAccessLogs(page, pageSize);
      }),

    // 根据IP获取访问记录（分页）
    byIp: adminProcedure
      .input(
        z.object({
          ip: z.string().min(1).max(45),
          page: z.number().int().positive().optional().default(1),
          pageSize: z.number().int().positive().max(200).optional().default(50),
        })
      )
      .query(async ({ input }) => {
        const { getIpAccessLogsByIp } = await import("../db");
        return await getIpAccessLogsByIp(input.ip, input.page || 1, input.pageSize || 50);
      }),

    // 获取指定IP今日访问次数
    getTodayCount: adminProcedure
      .input(z.object({ ip: z.string().min(1).max(45) }))
      .query(async ({ input }) => {
        const { getIpAccessCountToday } = await import("../db");
        return await getIpAccessCountToday(input.ip);
      }),

    // 获取当前IP今日访问次数（公开接口，用于前端显示）
    // 注意：只统计体验按钮点击次数（experience_click）
    getMyTodayCount: publicProcedure.query(async ({ ctx }) => {
      const clientIP = getClientIp(ctx.req);
      const { getSystemConfigNumber, getIpAuthAccessCountToday } = await import("../db");

      // 获取今日体验按钮点击次数
      const todayCount = await getIpAuthAccessCountToday(clientIP);
      const dailyLimit = await getSystemConfigNumber("unregistered_daily_limit", 10);

      // 调试日志（包含请求头信息，便于排查IP获取问题）
      const ipDebugInfo = {
        detectedIP: clientIP,
        xForwardedFor: ctx.req.headers["x-forwarded-for"],
        xRealIp: ctx.req.headers["x-real-ip"],
        xClientIp: ctx.req.headers["x-client-ip"],
        cfConnectingIp: ctx.req.headers["cf-connecting-ip"],
        socketRemoteAddress: ctx.req.socket?.remoteAddress,
        reqIp: (ctx.req as any).ip,
      };
      console.log(`[IP Access] getMyTodayCount - IP: ${clientIP}, count: ${todayCount}, limit: ${dailyLimit}`);
      console.log(`[IP Access] Debug info:`, JSON.stringify(ipDebugInfo, null, 2));

      return { count: todayCount, limit: dailyLimit };
    }),

    // 记录体验按钮点击（公开接口，计入访问限制）
    // 注意：已登录用户不受访问限制，直接记录即可
    recordExperienceClick: publicProcedure
      .input(z.object({
        experienceId: z.string().optional(), // 体验ID，用于统计
      }).optional())
      .mutation(async ({ ctx, input }) => {
        const clientIP = getClientIp(ctx.req);
        const { createIpAccessLog, getIpAuthAccessCountToday, getSystemConfigNumber } = await import("../db");

        // 构建 path，包含 experienceId 信息，便于后续统计
        const experienceId = input?.experienceId;
        const path = experienceId
          ? `/api/scenarios/iframe/${experienceId}`
          : ctx.req.path || "/";

        // 已登录用户：不受访问限制，直接记录
        if (ctx.user) {
          try {
            await createIpAccessLog({
              ip: clientIP,
              action: "experience_click",
              path: path,
              userAgent: ctx.req.headers["user-agent"] || null,
              userId: ctx.user.id,
            });
            console.log(`[IP Access] recordExperienceClick - Logged in user (ID: ${ctx.user.id}), IP: ${clientIP}, experienceId: ${experienceId}`);
            return { success: true };
          } catch (error) {
            console.error("[IP Access] Failed to record experience click for logged in user:", error);
            return { success: false, error: "记录失败" };
          }
        }

      // 未登录用户：需要检查访问限制
      const dailyLimit = await getSystemConfigNumber("unregistered_daily_limit", 10);
      const todayCount = await getIpAuthAccessCountToday(clientIP);

      // 调试日志：确保记录和查询使用相同的IP
      console.log(`[IP Access] recordExperienceClick - IP: ${clientIP}, currentCount: ${todayCount}, limit: ${dailyLimit}, experienceId: ${experienceId}`);

      // 如果限制为0，直接记录并返回错误（不允许访问）
      if (dailyLimit === 0) {
        try {
          await createIpAccessLog({
            ip: clientIP,
            action: "experience_click",
            path: path,
            userAgent: ctx.req.headers["user-agent"] || null,
            userId: null,
          });
          console.log(`[IP Access] recordExperienceClick - Limit is 0, recorded attempt for IP: ${clientIP}`);
        } catch (error) {
          console.error("[IP Access] Failed to record blocked experience click (limit=0):", error);
        }

        return {
          success: false,
          error: `今日访问次数已达上限（${dailyLimit}次），请明天再试或注册账号后继续使用`
        };
      }

      // 检查是否超过限制（在记录本次访问之前）
      if (todayCount >= dailyLimit) {
        // 即使超过限制，也记录这次尝试访问（用于统计和分析）
        try {
          await createIpAccessLog({
            ip: clientIP,
            action: "experience_click",
            path: path,
            userAgent: ctx.req.headers["user-agent"] || null,
            userId: null,
          });
        } catch (error) {
          console.error("[IP Access] Failed to record blocked experience click:", error);
        }

        return {
          success: false,
          error: `今日访问次数已达上限（${dailyLimit}次），请明天再试或注册账号后继续使用`
        };
      }

      // 记录体验按钮点击
      try {
        await createIpAccessLog({
          ip: clientIP,
          action: "experience_click",
          path: path,
          userAgent: ctx.req.headers["user-agent"] || null,
          userId: null,
        });

        // 记录后再次查询，确认记录成功（调试用）
        const newCount = await getIpAuthAccessCountToday(clientIP);
        console.log(`[IP Access] recordExperienceClick - After recording, newCount: ${newCount}, IP: ${clientIP}, experienceId: ${experienceId}`);

        return { success: true };
      } catch (error) {
        console.error("[IP Access] Failed to record experience click:", error);
        return { success: false, error: "记录失败" };
      }
    }),
});
