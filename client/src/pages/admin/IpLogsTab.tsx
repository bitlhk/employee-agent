import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, XCircle, User } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "./utils";

interface IpLogsTabProps {
  scenarioNameMap: Record<string, string>;
}

export function IpLogsTab({ scenarioNameMap }: IpLogsTabProps) {
  const [ipLogsPage, setIpLogsPage] = useState(1);
  const [ipLogsPageSize] = useState(50);
  const { data: ipAccessLogsData, isLoading: loadingIpAccessLogs, error: ipAccessLogsError, refetch: refetchIpAccessLogs } =
    trpc.ipAccessLogs.list.useQuery({ page: ipLogsPage, pageSize: ipLogsPageSize });

  const ipAccessLogs = Array.isArray(ipAccessLogsData?.data) ? ipAccessLogsData.data : [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>IP访问日志</CardTitle>
            <CardDescription>
              所有用户的访问记录（包括未登录用户），按时间倒序排列
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchIpAccessLogs()}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loadingIpAccessLogs ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : ipAccessLogsError ? (
          <div className="text-center py-12">
            <p className="text-sm text-destructive">IP访问日志加载失败：{ipAccessLogsError.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchIpAccessLogs()}>
              重试
            </Button>
          </div>
        ) : ipAccessLogs && ipAccessLogs.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>IP地址</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>操作类型</TableHead>
                    <TableHead>场景</TableHead>
                    <TableHead>体验名称</TableHead>
                    <TableHead>访问时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ipAccessLogs.map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.id}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {log.ip}
                      </code>
                    </TableCell>
                    <TableCell>
                      {log.userId ? (
                        <Badge variant="default" className="gap-1">
                          <User className="w-3 h-3" />
                          用户 #{log.userId}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <XCircle className="w-3 h-3" />
                          未登录
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          log.action === "experience_click" ? "default" :
                          log.action === "login" ? "secondary" :
                          log.action === "register" ? "secondary" :
                          "outline"
                        }
                      >
                        {log.action === "experience_click" ? "体验点击" :
                         log.action === "login" ? "登录" :
                         log.action === "register" ? "注册" :
                         log.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {log.scenarioId ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          log.scenarioId === "acquisition" ? "bg-red-100 text-red-700" :
                          log.scenarioId === "operations" ? "bg-blue-100 text-blue-700" :
                          log.scenarioId === "investment" ? "bg-green-100 text-green-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {scenarioNameMap[log.scenarioId] || log.scenarioId}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.experienceTitle ? (
                        <span className="text-sm">{log.experienceTitle}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDate(new Date(log.createdAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            {/* 分页控件 */}
            {ipAccessLogsData && ipAccessLogsData.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  共 {ipAccessLogsData.total} 条记录，第 {ipAccessLogsData.page} / {ipAccessLogsData.totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIpLogsPage(p => Math.max(1, p - 1))}
                    disabled={ipLogsPage === 1}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIpLogsPage(p => Math.min(ipAccessLogsData.totalPages, p + 1))}
                    disabled={ipLogsPage >= ipAccessLogsData.totalPages}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            暂无IP访问日志
          </div>
        )}
      </CardContent>
    </Card>
  );
}
