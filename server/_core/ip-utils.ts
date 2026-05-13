/**
 * IP地址获取和标准化工具
 * 统一所有IP获取逻辑，确保记录和查询时使用相同的IP
 */

/**
 * 标准化IP地址
 * - 将 IPv6 的 ::1 映射为 127.0.0.1
 * - 移除 IPv6 地址的方括号
 * - 处理 ::ffff:127.0.0.1 这种 IPv4-mapped IPv6 地址
 */
export function normalizeIp(ip: string): string {
  if (!ip) return "unknown";
  
  // 移除方括号（如果有）
  ip = ip.replace(/^\[|\]$/g, "");
  
  // IPv6 localhost 映射为 IPv4 localhost
  if (ip === "::1" || ip === "::ffff:127.0.0.1") {
    return "127.0.0.1";
  }
  
  // IPv4-mapped IPv6 地址（::ffff:192.168.1.1）提取 IPv4 部分
  const ipv4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    return ipv4MappedMatch[1];
  }
  
  return ip;
}

/**
 * 获取客户端IP地址
 * 优先从请求头获取，支持代理服务器场景
 * 
 * 优先级顺序：
 * 1. x-forwarded-for（代理服务器场景，取第一个IP）
 * 2. x-real-ip（nginx 等代理）
 * 3. x-client-ip（某些代理）
 * 4. cf-connecting-ip（Cloudflare）
 * 5. socket.remoteAddress（直接连接）
 * 6. req.ip（Express trust proxy 启用后）
 * 
 * @param req Express Request 对象或包含 headers 和 socket 的对象
 * @returns 标准化后的客户端IP地址
 */
export function getClientIp(req: any): string {
  // 1. 优先从 x-forwarded-for 获取（代理服务器场景）
  // x-forwarded-for 格式：client, proxy1, proxy2
  const xForwardedFor = req.headers?.["x-forwarded-for"] as string;
  if (xForwardedFor) {
    const ips = xForwardedFor.split(",").map(ip => ip.trim());
    // 返回第一个IP（客户端真实IP）
    if (ips[0]) {
      return normalizeIp(ips[0]);
    }
  }
  
  // 2. 从 x-real-ip 获取（nginx 等代理）
  const xRealIp = req.headers?.["x-real-ip"] as string;
  if (xRealIp) {
    return normalizeIp(xRealIp);
  }
  
  // 3. 从 x-client-ip 获取（某些代理）
  const xClientIp = req.headers?.["x-client-ip"] as string;
  if (xClientIp) {
    return normalizeIp(xClientIp);
  }
  
  // 4. 从 cf-connecting-ip 获取（Cloudflare）
  const cfConnectingIp = req.headers?.["cf-connecting-ip"] as string;
  if (cfConnectingIp) {
    return normalizeIp(cfConnectingIp);
  }
  
  // 5. 从 socket.remoteAddress 获取（直接连接）
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (remoteAddress) {
    return normalizeIp(remoteAddress);
  }
  
  // 6. 从 req.ip 获取（Express trust proxy 启用后）
  if (req.ip) {
    return normalizeIp(req.ip);
  }
  
  console.warn("[IP Utils] Could not determine client IP, using 'unknown'");
  return "unknown";
}

