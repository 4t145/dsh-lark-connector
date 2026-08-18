import { describe, expect, it } from "vitest";
import { resolveImageMediaType, sniffImageMediaType } from "./image-media.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const TEXT = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);

describe("sniffImageMediaType", () => {
  it("recognizes png, jpeg, webp and gif magic bytes", () => {
    expect(sniffImageMediaType(PNG)).toBe("image/png");
    expect(sniffImageMediaType(JPEG)).toBe("image/jpeg");
    expect(sniffImageMediaType(WEBP)).toBe("image/webp");
    expect(sniffImageMediaType(GIF)).toBe("image/gif");
  });

  it("returns null for unknown bytes", () => {
    expect(sniffImageMediaType(TEXT)).toBeNull();
    expect(sniffImageMediaType(new Uint8Array([]))).toBeNull();
  });
});

describe("resolveImageMediaType", () => {
  it("trusts a supported Content-Type header", () => {
    expect(resolveImageMediaType("image/jpeg; charset=binary", JPEG)).toBe("image/jpeg");
    expect(resolveImageMediaType("IMAGE/PNG", PNG)).toBe("image/png");
  });

  it("falls back to sniffing when the header is missing or unsupported", () => {
    expect(resolveImageMediaType(undefined, PNG)).toBe("image/png");
    expect(resolveImageMediaType("application/octet-stream", GIF)).toBe("image/gif");
  });

  it("returns null when nothing matches", () => {
    expect(resolveImageMediaType("text/plain", TEXT)).toBeNull();
  });
});
