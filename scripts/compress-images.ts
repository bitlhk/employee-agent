import sharp from "sharp";
import { readdir, stat } from "fs/promises";
import { join } from "path";

const IMAGES_DIR = join(process.cwd(), "client/public/images");

interface ImageStats {
  name: string;
  originalSize: number;
  compressedSize: number;
  reduction: number;
}

async function compressImage(filePath: string): Promise<ImageStats> {
  const originalStats = await stat(filePath);
  const originalSize = originalStats.size;
  const fileName = filePath.split("/").pop() || "";

  console.log(`压缩中: ${fileName} (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);

  // 压缩PNG图片
  // 大幅降低分辨率以减小文件大小
  const image = sharp(filePath);
  const metadata = await image.metadata();
  
  // 根据图片用途设置最大尺寸
  // 大幅降低分辨率以将文件大小压缩到10KB左右
  // 使用更小的分辨率，根据目标文件大小动态调整
  let maxWidth = 200; // 初始宽度200px（更小以获得更小的文件）
  let maxHeight = 200; // 初始高度200px
  
  let pipeline = image;
  if (metadata.width && metadata.height) {
    // 如果图片尺寸超过限制，进行缩放
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        withoutEnlargement: true,
        fit: 'inside', // 保持宽高比，确保图片完全在限制内
      });
      console.log(`  尺寸调整: ${metadata.width}x${metadata.height} → 最大 ${maxWidth}x${maxHeight}`);
    }
  }
  
  // 尝试压缩到目标大小（10KB左右）
  const targetSize = 10 * 1024; // 10KB
  let compressedBuffer: Buffer;
  let quality = 40; // 初始质量（更低以获得更小的文件）
  
  // 循环尝试不同的质量和尺寸，直到达到目标大小
  for (let attempt = 0; attempt < 5; attempt++) {
    // 重新创建pipeline（因为resize只能调用一次）
    let currentPipeline = image;
    if (metadata.width && metadata.height) {
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        currentPipeline = currentPipeline.resize(maxWidth, maxHeight, {
          withoutEnlargement: true,
          fit: 'inside',
        });
      }
    }
    
    compressedBuffer = await currentPipeline
      .png({
        quality: quality,
        compressionLevel: 9,
        adaptiveFiltering: true,
        palette: true,
        effort: 10,
      })
      .toBuffer();
    
    // 如果达到目标大小，退出循环
    if (compressedBuffer.length <= targetSize * 1.2) { // 允许20%的误差
      break;
    }
    
    // 如果还是太大，降低质量或尺寸
    if (compressedBuffer.length > targetSize * 2) {
      // 如果超过20KB，大幅降低尺寸和质量
      maxWidth = Math.max(150, maxWidth - 50);
      maxHeight = Math.max(150, maxHeight - 50);
      quality = Math.max(20, quality - 10);
    } else if (compressedBuffer.length > targetSize * 1.5) {
      // 如果超过15KB，降低尺寸和质量
      maxWidth = Math.max(150, maxWidth - 30);
      maxHeight = Math.max(150, maxHeight - 30);
      quality = Math.max(20, quality - 5);
    } else if (compressedBuffer.length > targetSize * 1.2) {
      // 如果超过12KB，降低尺寸和质量
      maxWidth = Math.max(150, maxWidth - 20);
      maxHeight = Math.max(150, maxHeight - 20);
      quality = Math.max(20, quality - 3);
    } else if (compressedBuffer.length > targetSize) {
      // 如果超过10KB，微调质量
      quality = Math.max(20, quality - 2);
    } else {
      // 接近目标，微调质量
      quality = Math.max(20, quality - 1);
    }
  }

  const compressedSize = compressedBuffer.length;

  // 写回文件
  await sharp(compressedBuffer).toFile(filePath);

  const reduction = ((originalSize - compressedSize) / originalSize) * 100;

  return {
    name: fileName,
    originalSize,
    compressedSize,
    reduction,
  };
}

async function main() {
  try {
    console.log("开始压缩图片...\n");

    const files = await readdir(IMAGES_DIR);
    const pngFiles = files.filter((f) => f.endsWith(".png"));

    if (pngFiles.length === 0) {
      console.log("未找到PNG文件");
      return;
    }

    const results: ImageStats[] = [];

    for (const file of pngFiles) {
      const filePath = join(IMAGES_DIR, file);
      try {
        const stats = await compressImage(filePath);
        results.push(stats);
      } catch (error) {
        console.error(`压缩 ${file} 失败:`, error);
      }
    }

    console.log("\n=== 压缩结果 ===");
    let totalOriginal = 0;
    let totalCompressed = 0;

    results.forEach((result) => {
      totalOriginal += result.originalSize;
      totalCompressed += result.compressedSize;
      console.log(
        `${result.name}: ${(result.originalSize / 1024 / 1024).toFixed(2)}MB → ${(result.compressedSize / 1024 / 1024).toFixed(2)}MB (减少 ${result.reduction.toFixed(1)}%)`
      );
    });

    console.log("\n=== 总计 ===");
    console.log(
      `原始总大小: ${(totalOriginal / 1024 / 1024).toFixed(2)}MB`
    );
    console.log(
      `压缩后总大小: ${(totalCompressed / 1024 / 1024).toFixed(2)}MB`
    );
    console.log(
      `总减少: ${((totalOriginal - totalCompressed) / 1024 / 1024).toFixed(2)}MB (${(((totalOriginal - totalCompressed) / totalOriginal) * 100).toFixed(1)}%)`
    );
  } catch (error) {
    console.error("压缩过程出错:", error);
    process.exit(1);
  }
}

main();

