export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the backend API origin.
export const getLoginUrl = () => {
  // 如果环境变量未设置，返回本地登录页面
  if (typeof window === "undefined") {
    return "/login";
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  
  // 如果 OAuth 相关环境变量未设置，返回本地登录页面
  if (!oauthPortalUrl || !appId) {
    return "/login";
  }

  try {
    // 使用后端 API URL 作为回调地址
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const redirectUri = `${apiUrl}/api/oauth/callback`;
    const state = btoa(redirectUri);

    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");

    return url.toString();
  } catch (error) {
    // 如果 URL 创建失败，返回本地登录页面
    console.warn("[Auth] Failed to generate OAuth URL, using local login:", error);
    return "/login";
  }
};
