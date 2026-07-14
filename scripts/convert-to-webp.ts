import sharp from "sharp";
import { readdir, stat } from "fs/promises";
import { join } from "path";

const IMAGES_DIR = join(process.cwd(), "client/public/images");

interface ConversionStats {
  name: string;
  originalSize: number;
  webpSize: number;
  reduction: number;
}

async function convertToWebP(filePath: string): Promise<ConversionStats> {
  const originalStats = await stat(filePath);
  const originalSize = originalStats.size;
  const fileName = filePath.split("/").pop() || "";
  const webpPath = filePath.replace(/\.png$/i, ".webp");

  console.log(`转换中: ${fileName} → ${fileName.replace(".png", ".webp")}`);

  // 转换为WebP格式，质量80%
  await sharp(filePath)
    .webp({ 
      quality: 80,
      effort: 6, // 压缩努力程度（0-6，6最慢但压缩率最高）
    })
    .toFile(webpPath);

  const webpStats = await stat(webpPath);
  const webpSize = webpStats.size;
  const reduction = ((originalSize - webpSize) / originalSize) * 100;

  return {
    name: fileName,
    originalSize,
    webpSize,
    reduction,
  };
}

async function main() {
  try {
    console.log("开始转换图片为WebP格式...\n");

    const files = await readdir(IMAGES_DIR);
    const pngFiles = files.filter((f) => f.toLowerCase().endsWith(".png"));

    if (pngFiles.length === 0) {
      console.log("未找到PNG文件");
      return;
    }

    const results: ConversionStats[] = [];

    for (const file of pngFiles) {
      const filePath = join(IMAGES_DIR, file);
      try {
        const stats = await convertToWebP(filePath);
        results.push(stats);
      } catch (error) {
        console.error(`转换 ${file} 失败:`, error);
      }
    }

    console.log("\n=== 转换结果 ===");
    let totalOriginal = 0;
    let totalWebp = 0;

    results.forEach((result) => {
      totalOriginal += result.originalSize;
      totalWebp += result.webpSize;
      console.log(
        `${result.name}: ${(result.originalSize / 1024).toFixed(1)}KB → ${(result.webpSize / 1024).toFixed(1)}KB (减少 ${result.reduction.toFixed(1)}%)`
      );
    });

    console.log("\n=== 总计 ===");
    console.log(`原始总大小: ${(totalOriginal / 1024).toFixed(1)}KB`);
    console.log(`WebP总大小: ${(totalWebp / 1024).toFixed(1)}KB`);
    console.log(
      `总减少: ${((totalOriginal - totalWebp) / 1024).toFixed(1)}KB (${(((totalOriginal - totalWebp) / totalOriginal) * 100).toFixed(1)}%)`
    );
    console.log("\n注意：WebP文件已生成，但需要在代码中更新图片引用以使用.webp文件");
  } catch (error) {
    console.error("转换过程出错:", error);
    process.exit(1);
  }
}

main();

