// 업로드 전 사진 리사이즈: 긴 변 1600px, 약 200KB 이하 JPEG (계획서 M4)

const MAX_SIDE = 1600;
const TARGET_BYTES = 200 * 1024;

export async function resizePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let width = Math.round(bitmap.width * scale);
  let height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  const draw = () => {
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  };
  draw();

  let quality = 0.85;
  let blob = await toJpeg(canvas, quality);
  // 품질을 낮추고, 그래도 크면 크기를 줄인다.
  while (blob.size > TARGET_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await toJpeg(canvas, quality);
  }
  while (blob.size > TARGET_BYTES && width > 800) {
    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    draw();
    blob = await toJpeg(canvas, quality);
  }
  bitmap.close();
  return { blob, width, height };
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality),
  );
}
