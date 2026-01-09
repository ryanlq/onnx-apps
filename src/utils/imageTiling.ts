/**
 * 图像切片工具
 * 将大图片分割成多个重叠的小块，便于批量推理
 */

export interface TileConfig {
  tileSize: number;    // 每块大小（默认 256）
  overlap: number;     // 边缘重叠（默认 16）
}

export interface Tile {
  x: number;           // 在原图中的 x 坐标
  y: number;           // 在原图中的 y 坐标
  width: number;       // 实际宽度
  height: number;      // 实际高度
  data: ImageData;     // 像素数据
}

/**
 * 计算切片参数
 */
export function calculateTileParams(
  imgWidth: number,
  imgHeight: number,
  config: TileConfig
): {
  tilesX: number;
  tilesY: number;
  totalTiles: number;
} {
  const { tileSize, overlap } = config;

  // 计算每块的实际步长（tileSize - overlap）
  const stepX = tileSize - overlap * 2;
  const stepY = tileSize - overlap * 2;

  // 计算需要多少块
  const tilesX = Math.ceil((imgWidth - overlap * 2) / stepX);
  const tilesY = Math.ceil((imgHeight - overlap * 2) / stepY);
  const totalTiles = tilesX * tilesY;

  return { tilesX, tilesY, totalTiles };
}

/**
 * 将图片切割成多个小块
 */
export function tileImage(
  canvas: HTMLCanvasElement,
  config: TileConfig,
  onProgress?: (current: number, total: number) => void
): Tile[] {
  const ctx = canvas.getContext('2d')!;
  const { tileSize, overlap } = config;

  const { tilesX, tilesY, totalTiles } = calculateTileParams(
    canvas.width,
    canvas.height,
    config
  );

  const tiles: Tile[] = [];
  const stepX = tileSize - overlap * 2;
  const stepY = tileSize - overlap * 2;

  let tileIndex = 0;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // 计算当前块的坐标
      const x = tx * stepX;
      const y = ty * stepY;

      // 计算实际块大小（边缘块可能较小）
      const actualWidth = Math.min(tileSize, canvas.width - x);
      const actualHeight = Math.min(tileSize, canvas.height - y);

      // 提取像素数据
      const imageData = ctx.getImageData(x, y, actualWidth, actualHeight);

      tiles.push({
        x,
        y,
        width: actualWidth,
        height: actualHeight,
        data: imageData
      });

      tileIndex++;

      // 进度回调
      if (onProgress) {
        onProgress(tileIndex, totalTiles);
      }
    }
  }

  return tiles;
}

/**
 * 将处理后的块拼接回完整图片
 */
export function stitchTiles(
  tiles: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    data: ImageData;
  }>,
  outputWidth: number,
  outputHeight: number
): HTMLCanvasElement {
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = outputWidth;
  resultCanvas.height = outputHeight;

  const ctx = resultCanvas.getContext('2d')!;

  // 拼接所有块
  for (const tile of tiles) {
    ctx.putImageData(tile.data, tile.x, tile.y);
  }

  return resultCanvas;
}

/**
 * 从增强后的 tile 中裁剪掉 overlap 区域，只保留中心区域
 */
export function trimTileOverlap(
  tile: ImageData,
  overlap: number
): ImageData {
  const { width, height, data } = tile;

  // 计算保留区域
  const startX = overlap;
  const startY = overlap;
  const endX = width - overlap;
  const endY = height - overlap;

  const cleanWidth = endX - startX;
  const cleanHeight = endY - startY;

  // 创建新的 ImageData
  const cleanData = new Uint8ClampedArray(cleanWidth * cleanHeight * 4);

  // 复制中心区域
  for (let y = 0; y < cleanHeight; y++) {
    for (let x = 0; x < cleanWidth; x++) {
      const srcIdx = ((y + startY) * width + (x + startX)) * 4;
      const dstIdx = (y * cleanWidth + x) * 4;

      cleanData[dstIdx] = data[srcIdx];
      cleanData[dstIdx + 1] = data[srcIdx + 1];
      cleanData[dstIdx + 2] = data[srcIdx + 2];
      cleanData[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return new ImageData(cleanData, cleanWidth, cleanHeight);
}
