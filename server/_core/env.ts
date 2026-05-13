// ── 启动期强校验：关键环境变量缺失则拒绝启动 ──
// 2026-04-18 fix: 测试模式（NODE_ENV=test 或 VITEST=1）不 process.exit，用 mock 占位，
// 以便 vitest/jest import 相关模块时不直接 kill 进程
const _isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;

const _requiredEnv = (key: string, label: string): string => {
  const val = process.env[key];
  if (!val || val === "changeme" || val === "linggan123") {
    if (_isTest) {
      // 测试环境 tolerate 缺失，返回可识别的 mock 值
      return `__test_mock_${key}__`;
    }
    console.error(`[FATAL] ${label} (${key}) 未配置或使用了默认弱值，拒绝启动。请在 .env 中设置。`);
    process.exit(1);
  }
  return val;
};

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: _requiredEnv("JWT_SECRET", "JWT 密钥"),
  databaseUrl: _requiredEnv("DATABASE_URL", "数据库连接"),
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
