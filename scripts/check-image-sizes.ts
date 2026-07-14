import sharp from "sharp";
import { readdir, stat } from "fs/promises";
import { join } from "path";

const IMAGES_DIR = join(process.cwd(), "client/public/images");

async function main() {
  const files = await readdir(IMAGES_DIR);
  const pngFiles = files.filter((f) => f.endsWith(".png"));

  console.log("=== 图片分辨率详情 ===\n");

  for (const file of pngFiles) {
    const filePath = join(IMAGES_DIR, file);
    try {
      const metadata = await sharp(filePath).metadata();
      const stats = await stat(filePath);
      const sizeKB = (stats.size / 1024).toFixed(0);
      console.log(
        `${file.padEnd(30)} ${metadata.width}x${metadata.height} (${sizeKB}KB)`
      );
    } catch (error) {
      console.error(`检查 ${file} 失败:`, error);
    }
  }
}

main();

