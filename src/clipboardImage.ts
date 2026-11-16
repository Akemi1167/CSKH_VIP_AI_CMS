const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif)$/i;

type PasteItem = { kind: string; type: string; getAsFile: () => File | null };

type PasteData = { items: ArrayLike<PasteItem>; files: ArrayLike<File> };

export function imageFromPaste(data: PasteData | null): File | null {
  if (!data) {
    return null;
  }
  for (const item of Array.from(data.items)) {
    const file = item.kind === "file" ? imageFile(item.getAsFile(), item.type) : null;
    if (file) {
      return file;
    }
  }
  for (const file of Array.from(data.files)) {
    const image = imageFile(file, file.type);
    if (image) {
      return image;
    }
  }
  return null;
}

function imageFile(file: File | null, typeHint: string): File | null {
  if (!file || file.size === 0) {
    return null;
  }
  const type = imageType(file.type) ?? imageType(typeHint);
  if (!type) {
    return null;
  }
  if (file.type === type) {
    return file;
  }
  const extension = type === "image/jpeg" ? "jpg" : type.slice("image/".length);
  return new File([file], file.name || `anh.${extension}`, { type });
}

function imageType(value: string): string | null {
  const raw = value.split(";")[0]?.trim().toLowerCase() ?? "";
  const type = raw === "image/jpg" ? "image/jpeg" : raw;
  return IMAGE_TYPE.test(type) ? type : null;
}
