import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { fetchWithRetry } from "./lib/network-utils";
import { applySettings, loadSettings, getSettings } from "./lib/settings";
import { bindSystemThemeListener, applyResolvedTheme } from "./lib/theme";
import "./index.css";

// 配置 QueryClient，针对弱网环境进行优化
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 弱网环境下增加重试次数和延迟
      retry: (failureCount, error) => {
        // 网络错误时重试 3 次
        if (error instanceof Error) {
          const isNetworkError =
            error.message.includes("Failed to fetch") ||
            error.message.includes("网络") ||
            error.message.includes("超时") ||
            error.message.includes("NetworkError");
          if (isNetworkError && failureCount < 3) {
            return true;
          }
        }
        // 5xx 错误重试 2 次
        if (error instanceof TRPCClientError && error.data?.httpStatus) {
          const status = error.data.httpStatus as number;
          if (status >= 500 && status < 600 && failureCount < 2) {
            return true;
          }
        }
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // 指数退避，最多 10 秒
      staleTime: 5 * 60 * 1000, // 5 分钟内数据视为新鲜
      gcTime: 10 * 60 * 1000, // 10 分钟后清理缓存
      refetchOnWindowFocus: false, // 弱网环境下减少自动刷新
      refetchOnReconnect: true, // 网络重连时刷新
      refetchOnMount: true,
      networkMode: "online", // 只在在线时执行查询
    },
    mutations: {
      // Mutation 重试策略
      // 2026-04-18: tRPC v11 RetryValue 类型只接受 2 参数 (failureCount, error)，
      // 但 react-query 底层 runtime 实际会传第 3 个 mutation 参数。这里用 as any cast 让 TS 通过。
      retry: ((failureCount: number, error: any, mutation: any) => {
        // 登录/注册/验证码相关的 mutation 不重试
        const mutationKey = mutation?.options?.mutationKey;
        if (mutationKey && Array.isArray(mutationKey)) {
          const key = mutationKey[0];
          if (
            key === "auth.login" || 
            key === "auth.register" ||
            key === "registration.sendVerificationCode" ||
            key === "auth.sendForgotPasswordVerificationCode"
          ) {
            return false; // 登录/注册/验证码失败不重试
          }
        }
        
        // 检查错误消息，如果是登录/注册/验证码相关的错误，不重试
        if (error instanceof Error) {
          const errorMsg = error.message.toLowerCase();
          if (
            errorMsg.includes("邮箱或密码错误") ||
            errorMsg.includes("登录失败") ||
            errorMsg.includes("注册失败") ||
            errorMsg.includes("已被注册") ||
            errorMsg.includes("密码错误") ||
            errorMsg.includes("验证码") ||
            errorMsg.includes("验证失败")
          ) {
            return false; // 登录/注册/验证码业务错误不重试
          }
          
          // 只有网络错误才重试
          const isNetworkError =
            errorMsg.includes("failed to fetch") ||
            errorMsg.includes("网络") ||
            errorMsg.includes("超时") ||
            errorMsg.includes("networkerror");
          if (isNetworkError && failureCount < 2) {
            return true;
          }
        }
        return false;
      }) as any,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      networkMode: "online",
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// 获取 API 基础 URL
// 统一使用相对路径，不区分开发/生产环境
const getApiUrl = () => {
  // 如果设置了 VITE_API_URL，使用完整 URL
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return `${apiUrl}/api/trpc`;
  }
  
  // 默认使用相对路径
  return "/api/trpc";
};

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: getApiUrl(),
      transformer: superjson,
      fetch: async (input, init) => {
        // 检测是否是登录/注册/验证码请求
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
        const isAuthRequest = 
          url.includes("/auth.login") || 
          url.includes("/auth.register") ||
          url.includes("/registration.sendVerificationCode") ||
          url.includes("/auth.sendForgotPasswordVerificationCode");
        
        // 使用带重试和超时的 fetch
        try {
          const response = await fetchWithRetry(input, {
            ...(init ?? {}),
            credentials: "include",
          }, {
            // 登录/注册请求不重试，其他请求重试 3 次
            maxRetries: isAuthRequest ? 0 : 3,
            retryDelay: 1000,
            timeout: 30000, // 30 秒超时
            retryCondition: (error) => {
              // 登录/注册请求不重试
              if (isAuthRequest) {
                return false;
              }
              // 其他请求：只有网络错误才重试
              if (error instanceof Error) {
                return (
                  error.message.includes("Failed to fetch") ||
                  error.message.includes("网络") ||
                  error.message.includes("超时") ||
                  error.message.includes("NetworkError")
                );
              }
              return false;
            },
          });
          
          // 检查响应状态码，登录/注册的 4xx 错误不重试
          if (isAuthRequest && response.status >= 400 && response.status < 500) {
            return response; // 直接返回，不重试
          }
          
          return response;
        } catch (error) {
          // 如果是网络错误，提供更友好的错误信息
          if (error instanceof Error) {
            if (error.message.includes("超时")) {
              throw new Error("请求超时，请稍后重试");
            }
            if (error.message.includes("Failed to fetch") || error.message.includes("网络")) {
              throw new Error("网络连接失败，请稍后重试");
            }
          }
          throw error;
        }
      },
    }),
  ],
});

// 初始化设置
const initialSettings = loadSettings();
applySettings(initialSettings);

// 监听系统主题变化
bindSystemThemeListener(() => {
  applyResolvedTheme(getSettings());
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
