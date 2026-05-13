/**
 * 路由保护组件
 * 用于保护需要登录才能访问的路由
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requireAdmin?: boolean;
};

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      // 未登录，重定向到登录页
      const currentPath = window.location.pathname;
      setLocation(`/login?redirect=${encodeURIComponent(currentPath)}`);
    } else if (!loading && isAuthenticated && requireAdmin && user?.role !== "admin") {
      // 已登录但不是管理员，重定向到首页
      setLocation("/");
    }
  }, [loading, isAuthenticated, user, requireAdmin, setLocation]);

  // 加载中
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  // 未登录
  if (!isAuthenticated) {
    return null; // useEffect会处理重定向
  }

  // 需要管理员权限但用户不是管理员
  if (requireAdmin && user?.role !== "admin") {
    return null; // useEffect会处理重定向
  }

  // 已登录且权限足够
  return <>{children}</>;
}

/**
 * 管理员路由保护组件
 * 只有管理员可以访问
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireAdmin={true}>{children}</ProtectedRoute>;
}

