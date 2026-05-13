import type { Plugin } from "vite";

/**
 * Vite 插件：为字体文件添加 font-display: swap
 * 优化字体加载性能，避免 FOIT (Flash of Invisible Text)
 */
export function fontDisplayPlugin(): Plugin {
  return {
    name: "font-display-swap",
    generateBundle(options, bundle) {
      // 处理 CSS 文件中的 @font-face，添加 font-display: swap
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "asset" && fileName.endsWith(".css")) {
          const source = chunk.source as string;
          // 为所有 @font-face 添加 font-display: swap
          const updated = source.replace(
            /@font-face\s*\{([^}]*)\}/gs,
            (match, content) => {
              // 如果已经有 font-display，跳过
              if (content.includes("font-display")) {
                return match;
              }
              // 在 font-family 之后添加 font-display: swap
              // 优先在 font-family 后添加，如果没有则在 src 之前添加
              if (content.includes("font-family")) {
                return `@font-face {${content.replace(
                  /(font-family:[^;]+;)/,
                  "$1\n  font-display: swap;"
                )}}`;
              } else if (content.includes("src:")) {
                return `@font-face {${content.replace(
                  /(\s+)(src:)/,
                  "$1font-display: swap;\n$1$2"
                )}}`;
              }
              // 如果都没有，在开头添加
              return `@font-face {\n  font-display: swap;${content}}`;
            }
          );
          chunk.source = updated;
        }
      }
    },
  };
}

