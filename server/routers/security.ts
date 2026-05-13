import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  getAllSecurityLogs,
  getSecurityLogsByIp,
  getSecurityLogsBySeverity,
  getSecurityLogById,
  getSecurityLogsByIds,
  updateSecurityLogStatus,
  batchUpdateSecurityLogStatus,
  createIpManagement,
  getAllIpManagement,
  getIpManagementByIp,
  getIpManagementByType,
  updateIpManagement,
  deleteIpManagement,
  restoreIpManagement,
} from "../db";

export const securityLogsRouter = router({
    // 获取所有安全日志（管理员用，分页）
    list: adminProcedure
      .input(
        z.object({
          page: z.number().int().positive().optional().default(1),
          pageSize: z.number().int().positive().max(200).optional().default(50),
          status: z.enum(["pending", "resolved", "ignored", "blocked"]).optional(),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        const page = input?.page || 1;
        const pageSize = input?.pageSize || 50;
        const result = await getAllSecurityLogs(page, pageSize);

        // 如果指定了状态，进行过滤
        if (input?.status) {
          const filteredData = result.data.filter(log => log.status === input.status);
          return {
            ...result,
            data: filteredData,
            total: filteredData.length,
            totalPages: Math.ceil(filteredData.length / pageSize),
          };
        }
        return result;
      }),

    // 根据 IP 地址获取安全日志（分页）
    byIp: adminProcedure
      .input(
        z.object({
          ip: z.string().min(1).max(45),
          page: z.number().int().positive().optional().default(1),
          pageSize: z.number().int().positive().max(200).optional().default(50),
        })
      )
      .query(async ({ input }) => {
        return await getSecurityLogsByIp(input.ip, input.page || 1, input.pageSize || 50);
      }),

    // 根据严重程度获取安全日志
    bySeverity: adminProcedure
      .input(
        z.object({
          severity: z.enum(["low", "medium", "high", "critical"]),
          limit: z.number().int().positive().max(1000).optional().default(100),
        })
      )
      .query(async ({ input }) => {
        return await getSecurityLogsBySeverity(input.severity, input.limit);
      }),

    // 更新单个日志状态（选择「封禁IP」时联动添加至 IP 管理封禁列表）
    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["pending", "resolved", "ignored", "blocked"]),
          note: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;
        await updateSecurityLogStatus(
          input.id,
          input.status,
          userId,
          input.note
        );
        // 封禁时联动：将 IP 加入封禁列表
        if (input.status === "blocked") {
          const log = await getSecurityLogById(input.id);
          if (log) {
            const existing = await getIpManagementByIp(log.ip);
            const alreadyBlocked = existing.some(
              (r) => (r.type === "blocked" || r.type === "blacklist") && r.isActive === "yes"
            );
            if (!alreadyBlocked) {
              await createIpManagement({
                ip: log.ip,
                type: "blocked",
                reason: (input.note || log.reason || "来自安全日志").substring(0, 500),
                severity: log.severity,
                createdBy: userId ?? undefined,
                notes: null,
                isActive: "yes",
              });
            }
          }
        }
        return { success: true };
      }),

    // 批量更新日志状态（选择「封禁IP」时联动：将所选日志涉及的 IP 批量加入封禁列表）
    batchUpdateStatus: adminProcedure
      .input(
        z.object({
          ids: z.array(z.number().int().positive()),
          status: z.enum(["pending", "resolved", "ignored", "blocked"]),
          note: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;
        await batchUpdateSecurityLogStatus(
          input.ids,
          input.status,
          userId,
          input.note
        );
        // 封禁时联动：将所选日志中的唯一 IP 批量加入封禁列表
        if (input.status === "blocked" && input.ids.length > 0) {
          const logs = await getSecurityLogsByIds(input.ids);
          const ipToLog = new Map<string, (typeof logs)[0]>();
          for (const log of logs) {
            if (!ipToLog.has(log.ip)) ipToLog.set(log.ip, log);
          }
          for (const [ip, log] of Array.from(ipToLog.entries())) {
            const existing = await getIpManagementByIp(ip);
            const alreadyBlocked = existing.some(
              (r) => (r.type === "blocked" || r.type === "blacklist") && r.isActive === "yes"
            );
            if (!alreadyBlocked) {
              await createIpManagement({
                ip,
                type: "blocked",
                reason: (input.note || log.reason || "来自安全日志批量处理").substring(0, 500),
                severity: log.severity,
                createdBy: userId ?? undefined,
                notes: null,
                isActive: "yes",
              });
            }
          }
        }
        return { success: true };
      }),
});

export const ipManagementRouter = router({
    // 获取所有IP管理记录
    list: adminProcedure
      .input(
        z.object({
          type: z.enum(["blacklist", "whitelist", "suspicious", "blocked"]).optional(),
          includeInactive: z.boolean().optional().default(false),
        }).optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          if (input?.type) {
            return await getIpManagementByType(input.type);
          }
          const all = await getAllIpManagement();
          if (input?.includeInactive) {
            return all;
          }
          return all.filter(ip => ip.isActive === "yes");
        } catch (error) {
          console.error("[IP Management] Failed to list IPs:", error);
          // 如果表不存在，返回空数组而不是抛出错误
          return [];
        }
      }),

    // 根据IP获取管理记录
    byIp: adminProcedure
      .input(z.object({ ip: z.string().min(1).max(45) }))
      .query(async ({ input }) => {
        return await getIpManagementByIp(input.ip);
      }),

    // 创建IP管理记录
    create: adminProcedure
      .input(
        z.object({
          ip: z.string().min(1).max(45),
          type: z.enum(["blacklist", "whitelist", "suspicious", "blocked"]),
          reason: z.string().max(500).optional(),
          severity: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
          expiresAt: z.string().datetime().nullable().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;
        const id = await createIpManagement({
          ip: input.ip,
          type: input.type,
          reason: input.reason || null,
          severity: input.severity,
          createdBy: userId || null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          notes: input.notes || null,
          isActive: "yes",
        });
        return { success: true, id };
      }),

    // 更新IP管理记录
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z.string().max(500).optional(),
          severity: z.enum(["low", "medium", "high", "critical"]).optional(),
          expiresAt: z.string().datetime().nullable().optional(),
          notes: z.string().optional(),
          isActive: z.enum(["yes", "no"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...updates } = input;
        const updateData: any = {};
        if (updates.reason !== undefined) updateData.reason = updates.reason;
        if (updates.severity !== undefined) updateData.severity = updates.severity;
        if (updates.expiresAt !== undefined) {
          updateData.expiresAt = updates.expiresAt ? new Date(updates.expiresAt) : null;
        }
        if (updates.notes !== undefined) updateData.notes = updates.notes;
        if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

        await updateIpManagement(id, updateData);
        return { success: true };
      }),

    // 删除IP管理记录（软删除）
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteIpManagement(input.id);
        return { success: true };
      }),

    // 恢复IP管理记录
    restore: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await restoreIpManagement(input.id);
        return { success: true };
      }),

    // 批量操作
    batchDelete: adminProcedure
      .input(z.object({ ids: z.array(z.number().int().positive()) }))
      .mutation(async ({ input }) => {
        for (const id of input.ids) {
          await deleteIpManagement(id);
        }
        return { success: true };
      }),
});
