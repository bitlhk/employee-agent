/**
 * 网络工具函数 - 弱网加固
 * 提供请求重试、超时处理等功能
 */

// 带超时的 fetch
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeout: number = 30000 // 默认 30 秒
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（${timeout}ms）`);
    }
    throw error;
  }
}

// 带重试的 fetch
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    retryCondition?: (error: unknown) => boolean;
    timeout?: number;
  } = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryCondition = (error) => {
      // 网络错误或超时才重试
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
    timeout = 30000,
  } = options;

  let lastError: unknown;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(input, init, timeout);
      
      // 如果响应状态码是 5xx，也进行重试
      if (response.status >= 500 && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
        attempt++;
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      // 如果不满足重试条件，直接抛出错误
      if (!retryCondition(error)) {
        throw error;
      }

      // 如果还有重试次数，等待后重试
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt); // 指数退避
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}


