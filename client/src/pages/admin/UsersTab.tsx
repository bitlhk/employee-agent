import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KeyRound, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { formatDate } from "./utils";

interface UsersTabProps {
  registrations: any[];
  loadingUsers: boolean;
}

export function UsersTab({ registrations, loadingUsers }: UsersTabProps) {
  const [passwordTarget, setPasswordTarget] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState("");
  // 登录用户访问级别管理 — only used by this tab
  const { data: authUsersData, refetch: refetchAuthUsers } = trpc.auth.listUsers.useQuery(undefined);
  const authUsers = Array.isArray(authUsersData) ? authUsersData : [];
  const setUserAccessLevelMutation = trpc.auth.setUserAccessLevel.useMutation({
    onSuccess: () => {
      toast.success("用户访问级别已更新");
      refetchAuthUsers();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });
  const setUserPasswordMutation = trpc.auth.setUserPassword.useMutation({
    onSuccess: () => {
      toast.success("密码已更新");
      setPasswordTarget(null);
      setNewPassword("");
      refetchAuthUsers();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const openPasswordDialog = (user: any) => {
    setPasswordTarget(user);
    setNewPassword("");
  };

  const submitPassword = () => {
    if (!passwordTarget) return;
    setUserPasswordMutation.mutate({
      userId: Number(passwordTarget.id),
      password: newPassword,
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>注册用户列表</CardTitle>
          <CardDescription>
            所有通过落地页注册的用户信息
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : registrations && registrations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>公司</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>注册时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registrations.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.id}</TableCell>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>{user.company}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              暂无注册用户
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>登录用户访问级别</CardTitle>
          <CardDescription>
            快速标注哪些用户可以查看全部 Demo（all）或仅查看公开 Demo（public_only）
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authUsers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>访问级别</TableHead>
                  <TableHead className="w-72">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authUsers.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.id}</TableCell>
                    <TableCell>{u.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {u.role === "admin" ? "管理员" : "用户"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.accessLevel === "all" ? "default" : "outline"}>
                        {u.accessLevel === "all" ? "全部可见" : "仅公开"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={u.accessLevel || "public_only"}
                          onValueChange={(value: "public_only" | "all") =>
                            setUserAccessLevelMutation.mutate({ userId: u.id, accessLevel: value })
                          }
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="public_only">仅公开</SelectItem>
                            <SelectItem value="all">全部可见</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openPasswordDialog(u)}
                        >
                          <KeyRound className="h-4 w-4" />
                          改密码
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-10 text-muted-foreground">暂无登录用户记录</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(passwordTarget)} onOpenChange={(open) => {
        if (!open) {
          setPasswordTarget(null);
          setNewPassword("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改登录密码</DialogTitle>
            <DialogDescription>
              为 {passwordTarget?.email || "该用户"} 设置新的登录密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">新密码</Label>
            <Input
              id="admin-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newPassword.length >= 6) submitPassword();
              }}
              autoComplete="new-password"
              placeholder="至少 6 位"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPasswordTarget(null);
                setNewPassword("");
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={submitPassword}
              disabled={newPassword.length < 6 || setUserPasswordMutation.isPending}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
