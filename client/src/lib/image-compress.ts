const DEFAULT_TARGET_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_EDGE = 2560;

function isCompressibleImage(file: File) {
  if (!file.type.startsWith("image/")) return false;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return false;
  return true;
}

function replaceExtension(name: string, ext: string) {
  const cleanExt = ext.startsWith(".") ? ext : `.${ext}`;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}${cleanExt}`;
  return `${name.slice(0, dot)}${cleanExt}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function readImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image_decode_failed"));
    });
    image.src = url;
    return await loaded;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawImageToCanvas(image: HTMLImageElement, scale: number) {
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

async function canvasHasTransparency(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const stepX = Math.max(1, Math.floor(canvas.width / 100));
  const stepY = Math.max(1, Math.floor(canvas.height / 100));
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const alpha = ctx.getImageData(x, y, 1, 1).data[3];
      if (alpha < 255) return true;
    }
  }
  return false;
}

export async function compressImageIfNeeded(
  file: File,
  options: { targetBytes?: number; maxEdge?: number } = {},
): Promise<File> {
  const targetBytes = options.targetBytes ?? DEFAULT_TARGET_BYTES;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  if (file.size <= targetBytes || !isCompressibleImage(file)) return file;

  try {
    const image = await readImage(file);
    const largestEdge = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
    if (!largestEdge) return file;

    let scale = Math.min(1, maxEdge / largestEdge);
    let best: Blob | null = null;
    let bestType = "image/jpeg";
    let bestName = replaceExtension(file.name, ".jpg");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = drawImageToCanvas(image, scale);
      const hasAlpha = await canvasHasTransparency(canvas);
      const candidates: Array<{ type: string; ext: string; qualities: number[] }> = hasAlpha
        ? [{ type: "image/webp", ext: ".webp", qualities: [0.9, 0.8, 0.7, 0.6] }]
        : [
            { type: "image/webp", ext: ".webp", qualities: [0.9, 0.8, 0.7, 0.6] },
            { type: "image/jpeg", ext: ".jpg", qualities: [0.88, 0.78, 0.68, 0.58] },
          ];

      for (const candidate of candidates) {
        for (const quality of candidate.qualities) {
          const blob = await canvasToBlob(canvas, candidate.type, quality);
          if (!blob) continue;
          if (!best || blob.size < best.size) {
            best = blob;
            bestType = candidate.type;
            bestName = replaceExtension(file.name, candidate.ext);
          }
          if (blob.size <= targetBytes) {
            return new File([blob], replaceExtension(file.name, candidate.ext), {
              type: candidate.type,
              lastModified: file.lastModified,
            });
          }
        }
      }

      scale *= 0.78;
    }

    if (best && best.size < file.size) {
      return new File([best], bestName, { type: bestType, lastModified: file.lastModified });
    }
  } catch {
    return file;
  }

  return file;
}

export async function prepareChatAttachments(files: File[]): Promise<File[]> {
  const prepared: File[] = [];
  for (const file of files) {
    prepared.push(await compressImageIfNeeded(file));
  }
  return prepared;
}
