const QUALITY = 0.9;
const MAX_EDGE = 2560;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    image.src = src;
  });

export async function imageFileToWebp(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/webp") {
    return file;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    if (!width || !height) {
      throw new Error("INVALID_IMAGE_SIZE");
    }
    if (width > MAX_EDGE || height > MAX_EDGE) {
      const scale = Math.min(MAX_EDGE / width, MAX_EDGE / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("CANVAS_UNSUPPORTED");
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("WEBP_ENCODE_FAILED"))), "image/webp", QUALITY);
    });
    const base = file.name.includes(".") ? file.name.replace(/\.[^/.]+$/, "") : "anh";
    return new File([blob], `${base}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
