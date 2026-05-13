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

interface LogsTabProps {
  scenarioNameMap: Record<string, string>;
}

export function LogsTab({ scenarioNameMap }: LogsTabProps) {
  const [visitLogsPage, setVisitLogsPage] = useState(1);
  const [visitLogsPageSize] = useState(50);
  const { data: allVisitsData, isLoading: loadingAllVisits, error: allVisitsError, refetch: refetchAllVisits } =
    trpc.visitStats.list.useQuery({ page: visitLogsPage, pageSize: visitLogsPageSize });

  const allVisits = Array.isArray(allVisitsData?.data) ? allVisitsData.data : [];

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle>访问日志</CardTitle>
        <CardDescription>
          用户点击体验按钮的详细记录
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadingAllVisits ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : allVisitsError ? (
          <div className="text-center py-12">
            <p className="text-sm text-destructive">访问日志加载失败：{allVisitsError.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchAllVisits()}>
              重试
            </Button>
          </div>
        ) : Array.isArray(allVisits) && allVisits.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">ID</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>场景</TableHead>
                    <TableHead>体验名称</TableHead>
                    <TableHead>点击时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allVisits.map((visit: any) => (
                    <TableRow key={visit.id}>
                      <TableCell className="font-medium">{visit.id}</TableCell>
                      <TableCell>
                        {(visit.userId && visit.userId > 0) || (visit.registrationId && visit.registrationId > 0) ? (
                          <Badge variant="default" className="gap-1">
                            <User className="w-3 h-3" />
                            用户 #{(visit.userId && visit.userId > 0) ? visit.userId : visit.registrationId}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <XCircle className="w-3 h-3" />
                            未登录
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          visit.scenarioId === "acquisition" ? "bg-red-100 text-red-700" :
                          visit.scenarioId === "operations" ? "bg-blue-100 text-blue-700" :
                          "bg-green-100 text-green-700"
                        }`}>
                          {scenarioNameMap[visit.scenarioId] || visit.scenarioId}
                        </span>
                      </TableCell>
                      <TableCell>{visit.experienceTitle}</TableCell>
                      <TableCell>{formatDate(new Date(visit.clickedAt))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* 分页控件 */}
            {allVisitsData && allVisitsData.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  共 {allVisitsData.total} 条记录，第 {allVisitsData.page} / {allVisitsData.totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisitLogsPage(p => Math.max(1, p - 1))}
                    disabled={visitLogsPage === 1}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisitLogsPage(p => Math.min(allVisitsData.totalPages, p + 1))}
                    disabled={visitLogsPage >= allVisitsData.totalPages}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            暂无访问日志
          </div>
        )}
      </CardContent>
    </Card>
  );
}
