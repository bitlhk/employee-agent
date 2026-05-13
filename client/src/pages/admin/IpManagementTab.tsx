import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDate } from "./utils";

export interface IpManagementTabHandle {
  refetch: () => void;
}

export function IpManagementTab() {
  const [ipManagementType, setIpManagementType] = useState<"blacklist" | "whitelist" | "suspicious" | "blocked" | "all">("all");
  const { data: ipManagementListData, isLoading: loadingIpManagement, refetch: refetchIpManagement } =
    trpc.ipManagement.list.useQuery({
      type: ipManagementType === "all" ? undefined : ipManagementType,
      includeInactive: false,
    });

  const ipManagementList = Array.isArray(ipManagementListData) ? ipManagementListData : [];

  const [newIp, setNewIp] = useState({ ip: "", type: "blacklist" as const, reason: "", severity: "medium" as const, notes: "" });

  const createIp = trpc.ipManagement.create.useMutation({
    onSuccess: () => {
      refetchIpManagement();
      setNewIp({ ip: "", type: "blacklist", reason: "", severity: "medium", notes: "" });
    },
  });

  const deleteIp = trpc.ipManagement.delete.useMutation({
    onSuccess: () => {
      refetchIpManagement();
    },
  });

  const restoreIp = trpc.ipManagement.restore.useMutation({
    onSuccess: () => {
      refetchIpManagement();
    },
  });

  return (
    <div className="space-y-6">
      {/* 添加新IP */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>添加IP管理记录</CardTitle>
          <CardDescription>添加IP到黑名单、白名单、可疑IP或封禁列表</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>IP地址</Label>
              <Input
                type="text"
                placeholder="例如: 192.168.1.1"
                value={newIp.ip}
                onChange={(e) => setNewIp({ ...newIp, ip: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={newIp.type} onValueChange={(v: any) => setNewIp({ ...newIp, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blacklist">黑名单</SelectItem>
                  <SelectItem value="whitelist">白名单</SelectItem>
                  <SelectItem value="suspicious">可疑IP</SelectItem>
                  <SelectItem value="blocked">封禁IP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>严重程度</Label>
              <Select value={newIp.severity} onValueChange={(v: any) => setNewIp({ ...newIp, severity: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="critical">严重</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>原因</Label>
              <Input
                type="text"
                placeholder="添加原因说明"
                value={newIp.reason}
                onChange={(e) => setNewIp({ ...newIp, reason: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>备注</Label>
              <Textarea
                placeholder="添加备注信息（可选）"
                value={newIp.notes}
                onChange={(e) => setNewIp({ ...newIp, notes: e.target.value })}
                rows={2}
              />
            </div>
            <div className="md:col-span-2">
              <Button
                onClick={() => {
                  if (!newIp.ip) return;
                  createIp.mutate({
                    ip: newIp.ip,
                    type: newIp.type,
                    reason: newIp.reason || undefined,
                    severity: newIp.severity,
                    notes: newIp.notes || undefined,
                  });
                  setNewIp({ ip: "", type: "blacklist", reason: "", severity: "medium", notes: "" });
                }}
                disabled={!newIp.ip || createIp.isPending}
                className="w-full"
              >
                {createIp.isPending ? "添加中..." : "添加IP"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* IP列表 */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>IP管理列表</CardTitle>
              <CardDescription>管理黑名单、白名单、可疑IP和封禁IP</CardDescription>
            </div>
            <Select value={ipManagementType} onValueChange={(v: any) => setIpManagementType(v)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="blacklist">黑名单</SelectItem>
                <SelectItem value="whitelist">白名单</SelectItem>
                <SelectItem value="suspicious">可疑IP</SelectItem>
                <SelectItem value="blocked">封禁IP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingIpManagement ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : ipManagementList && ipManagementList.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>IP地址</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>严重程度</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ipManagementList.map((ip) => {
                  const typeColors: Record<string, string> = {
                    blacklist: "bg-red-100 text-red-700",
                    whitelist: "bg-green-100 text-green-700",
                    suspicious: "bg-yellow-100 text-yellow-700",
                    blocked: "bg-orange-100 text-orange-700",
                  };
                  const typeNames: Record<string, string> = {
                    blacklist: "黑名单",
                    whitelist: "白名单",
                    suspicious: "可疑IP",
                    blocked: "封禁IP",
                  };

                  return (
                    <TableRow key={ip.id}>
                      <TableCell className="font-medium">{ip.id}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-secondary px-2 py-1 rounded">
                          {ip.ip}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge className={typeColors[ip.type] ?? "bg-gray-100 text-gray-700"}>
                          {typeNames[ip.type] ?? ip.type ?? "其他"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={ip.reason || ""}>
                        {ip.reason || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          ip.severity === "low" ? "bg-blue-100 text-blue-700" :
                          ip.severity === "medium" ? "bg-yellow-100 text-yellow-700" :
                          ip.severity === "high" ? "bg-orange-100 text-orange-700" :
                          "bg-red-100 text-red-700"
                        }>
                          {ip.severity === "low" ? "低" :
                           ip.severity === "medium" ? "中" :
                           ip.severity === "high" ? "高" : "严重"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(ip.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ip.expiresAt ? formatDate(ip.expiresAt) : "永久"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ip.isActive === "yes" ? "default" : "outline"}>
                          {ip.isActive === "yes" ? "激活" : "已禁用"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {ip.isActive === "yes" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteIp.mutate({ id: ip.id })}
                              className="text-destructive"
                            >
                              禁用
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => restoreIp.mutate({ id: ip.id })}
                              disabled={restoreIp.isPending}
                            >
                              恢复
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              暂无IP管理记录
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
