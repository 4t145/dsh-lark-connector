import type { ImageMediaType } from "@deepseek-ai/dsh-attachment";

const SUPPORTED: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 按魔数识别图片编码类型；无法识别时返回 null。 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
    return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  )
    return "image/gif";
  return null;
}

/** 优先信任 Content-Type 头，回退到魔数识别；都不支持时返回 null。 */
export function resolveImageMediaType(
  contentType: string | undefined,
  data: Uint8Array,
): ImageMediaType | null {
  if (contentType !== undefined) {
    const declared = contentType.split(";")[0]?.trim().toLowerCase();
    const match = SUPPORTED.find((mediaType) => mediaType === declared);
    if (match !== undefined) return match;
  }
  return sniffImageMediaType(data);
}
