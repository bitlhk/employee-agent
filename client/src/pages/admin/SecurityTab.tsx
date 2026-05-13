import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Ban,
  Eye,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "./utils";

interface SecurityTabProps {
  refetchIpManagement: () => void;
}

export function SecurityTab({ refetchIpManagement }: SecurityTabProps) {
  const [selectedLogs, setSelectedLogs] = useState<number[]>([]);
  const [processingLog, setProcessingLog] = useState<number | null>(null);
  const [processNote, setProcessNote] = useState("");
  const [processStatus, setProcessStatus] = useState<"resolved" | "ignored" | "blocked">("resolved");

  const [securityLogsPage, setSecurityLogsPage] = useState(1);
  const [securityLogsPageSize] = useState(50);
  const { data: securityLogsData, isLoading: loadingSecurityLogs, refetch: refetchSecurityLogs } =
    trpc.securityLogs.list.useQuery({ page: securityLogsPage, pageSize: securityLogsPageSize });

  const securityLogs = Array.isArray(securityLogsData?.data) ? securityLogsData.data : [];
  const pendingLogs = Array.isArray(securityLogs) ? securityLogs.filter(log => log.status === "pending") : [];

  // 更新日志状态
  const updateLogStatus = trpc.securityLogs.updateStatus.useMutation({
    onSuccess: (_data, variables) => {
      refetchSecurityLogs();
      setProcessingLog(null);
      setProcessNote("");
      setSelectedLogs([]);
      if (variables?.status === "blocked") {
        refetchIpManagement();
      }
    },
  });

  // 批量更新日志状态
  const batchUpdateStatus = trpc.securityLogs.batchUpdateStatus.useMutation({
    onSuccess: (_data, variables) => {
      refetchSecurityLogs();
      setProcessingLog(null);
      setSelectedLogs([]);
      setProcessNote("");
      if (variables?.status === "blocked") {
        refetchIpManagement();
      }
    },
  });

  const handleProcessLog = (logId: number) => {
    setProcessingLog(logId);
    setProcessNote("");
    setProcessStatus("resolved");
  };

  const handleBatchProcess = () => {
    if (selectedLogs.length === 0) return;
    setProcessingLog(0);
    setProcessNote("");
    setProcessStatus("resolved");
  };

  const handleConfirmProcess = () => {
    if (processingLog === null) return;

    if (processingLog === 0) {
      batchUpdateStatus.mutate({
        ids: selectedLogs,
        status: processStatus,
        note: processNote || undefined,
      });
    } else {
      updateLogStatus.mutate({
        id: processingLog,
        status: processStatus,
        note: processNote || undefined,
      });
    }
  };

  const toggleLogSelection = (logId: number) => {
    setSelectedLogs(prev =>
      prev.includes(logId)
        ? prev.filter(id => id !== logId)
        : [...prev, logId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedLogs.length === pendingLogs.length) {
      setSelectedLogs([]);
    } else {
      setSelectedLogs(pendingLogs.map(log => log.id));
    }
  };

  return (
    <>
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>安全日志</CardTitle>
              <CardDescription>
                查看和处理安全事件、速率限制告警和4xx错误
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {pendingLogs.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="gap-2"
                  >
                    {selectedLogs.length === pendingLogs.length ? "取消全选" : "全选待处理"}
                  </Button>
                  {selectedLogs.length > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleBatchProcess}
                      className="gap-2"
                    >
                      批量处理 ({selectedLogs.length})
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSecurityLogs ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : securityLogs && securityLogs.length > 0 ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={selectedLogs.length === pendingLogs.length && pendingLogs.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead className="w-12">ID</TableHead>
                    <TableHead>IP地址</TableHead>
                    <TableHead>路径</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>严重程度</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {securityLogs.map((log) => {
                    const isPending = log.status === "pending";
                    const isSelected = selectedLogs.includes(log.id);
                    const severityColors = {
                      low: "bg-blue-100 text-blue-700",
                      medium: "bg-yellow-100 text-yellow-700",
                      high: "bg-orange-100 text-orange-700",
                      critical: "bg-red-100 text-red-700",
                    };
                    const statusColors = {
                      pending: "bg-gray-100 text-gray-700",
                      resolved: "bg-green-100 text-green-700",
                      ignored: "bg-gray-100 text-gray-500",
                      blocked: "bg-red-100 text-red-700",
                    };
                    const statusIcons = {
                      pending: AlertTriangle,
                      resolved: CheckCircle,
                      ignored: XCircle,
                      blocked: Ban,
                    };
                    const StatusIcon = statusIcons[log.status as keyof typeof statusIcons] || AlertTriangle;

                    return (
                      <TableRow
                        key={log.id}
                        className={isPending ? "bg-yellow-50/50" : ""}
                      >
                        <TableCell>
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleLogSelection(log.id)}
                              className="rounded"
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{log.id}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-secondary px-2 py-1 rounded">
                            {log.ip}
                          </code>
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={log.path}>
                          {log.path}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" title={log.reason}>
                          {log.reason}
                        </TableCell>
                        <TableCell>
                          <Badge className={severityColors[log.severity]}>
                            {log.severity === "low" ? "低" :
                             log.severity === "medium" ? "中" :
                             log.severity === "high" ? "高" : "严重"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusColors[log.status]}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {log.status === "pending" ? "待处理" :
                             log.status === "resolved" ? "已解决" :
                             log.status === "ignored" ? "已忽略" : "已封禁"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          {isPending && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleProcessLog(log.id)}
                              className="gap-1"
                            >
                              <Eye className="w-4 h-4" />
                              处理
                            </Button>
                          )}
                          {log.handledNote && (
                            <div className="text-xs text-muted-foreground mt-1" title={log.handledNote}>
                              备注: {log.handledNote.substring(0, 20)}...
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
              {/* 分页控件 */}
              {securityLogsData && securityLogsData.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    共 {securityLogsData.total} 条记录，第 {securityLogsData.page} / {securityLogsData.totalPages} 页
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSecurityLogsPage(p => Math.max(1, p - 1))}
                      disabled={securityLogsPage === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSecurityLogsPage(p => Math.min(securityLogsData.totalPages, p + 1))}
                      disabled={securityLogsPage >= securityLogsData.totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              暂无安全日志
            </div>
          )}
        </CardContent>
      </Card>

      {/* 处理日志对话框 */}
      <Dialog open={processingLog !== null} onOpenChange={(open) => !open && setProcessingLog(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {processingLog === 0 ? "批量处理安全日志" : "处理安全日志"}
            </DialogTitle>
            <DialogDescription>
              {processingLog === 0
                ? `将处理 ${selectedLogs.length} 条日志`
                : "选择处理方式并添加备注（可选）"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>处理方式</Label>
              <Select value={processStatus} onValueChange={(v: any) => setProcessStatus(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span>已解决</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="ignored">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-gray-600" />
                      <span>忽略</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="blocked">
                    <div className="flex items-center gap-2">
                      <Ban className="w-4 h-4 text-red-600" />
                      <span>封禁IP</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {processStatus === "blocked" && (
                <p className="text-sm text-amber-600 mt-1.5">
                  {processingLog === 0
                    ? "同时将把所选日志涉及的 IP 批量加入封禁列表"
                    : "同时将把该 IP 加入封禁列表"}
                  ，可在「IP 管理」中查看
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>处理备注（可选）</Label>
              <Textarea
                placeholder="添加处理备注..."
                value={processNote}
                onChange={(e) => setProcessNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcessingLog(null)}>
              取消
            </Button>
            <Button onClick={handleConfirmProcess} disabled={updateLogStatus.isPending || batchUpdateStatus.isPending}>
              {updateLogStatus.isPending || batchUpdateStatus.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                "确认处理"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
