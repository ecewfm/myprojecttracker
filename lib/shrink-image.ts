/**
 * Shrink images in the browser before they're uploaded.
 *
 * A screenshot off a phone is routinely 4–8 MB and 4000px wide, and none of
 * that detail survives being looked at in a thumbnail or a Cliq preview.
 * Downscaling here means uploads finish quickly on a bad connection, storage
 * stays small, and nothing ever approaches the 50 MB ceiling.
 *
 * Originals are left alone when they're already small — re-encoding a 200 KB
 * PNG only makes it worse.
 */

/** Longest edge after resizing. Comfortably past any screen it'll be viewed on. */
const MAX_EDGE = 2200;

/** Anything under this is uploaded untouched. */
const LEAVE_ALONE = 600 * 1024;      // 600 KB

/** What we aim to come in under. */
const TARGET = 1.5 * 1024 * 1024;    // 1.5 MB

/** Hard stop, well inside Supabase's per-file limit. */
export const MAX_INPUT = 50 * 1024 * 1024;

export const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export interface Shrunk {
  file: File;
  originalBytes: number;
  wasResized: boolean;
}

const readable = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export { readable };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns a smaller file, or the original when shrinking wouldn't help.
 * Never throws for ordinary reasons — if anything goes wrong we upload what
 * we were given rather than losing the user's image.
 */
export async function shrink(file: File): Promise<Shrunk> {
  const original = file.size;
  const untouched = { file, originalBytes: original, wasResized: false };

  // GIFs are usually animated, and canvas would flatten them to one frame.
  if (file.type === "image/gif") return untouched;
  if (file.size <= LEAVE_ALONE) return untouched;

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.width, img.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return untouched;

    // PNGs with transparency go to WebP rather than JPEG, which would fill
    // the transparent areas with black.
    const keepAlpha = file.type === "image/png" || file.type === "image/webp";
    const outType = keepAlpha ? "image/webp" : "image/jpeg";

    if (!keepAlpha) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Drop quality in steps until it's under target, but not past the point
    // where text in a screenshot stops being readable.
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      blob = await toBlob(canvas, outType, quality);
      if (blob && blob.size <= TARGET) break;
    }
    if (!blob) return untouched;

    // If the "shrunk" version is bigger, the original was already efficient.
    if (blob.size >= original) return untouched;

    const ext = outType === "image/webp" ? "webp" : "jpg";
    const name = file.name.replace(/\.[^.]*$/, "") + "." + ext;

    return {
      file: new File([blob], name, { type: outType, lastModified: Date.now() }),
      originalBytes: original,
      wasResized: true,
    };
  } catch {
    // Canvas is blocked in some contexts. Uploading the original is better
    // than failing.
    return untouched;
  }
}

/** Why a file can't be accepted at all, or null if it's fine. */
export function reject(file: File): string | null {
  if (!ALLOWED.includes(file.type)) {
    return `${file.name} isn't a JPG, PNG, GIF or WebP.`;
  }
  if (file.size > MAX_INPUT) {
    return `${file.name} is ${readable(file.size)}. Even after shrinking that's too big — 50 MB is the ceiling.`;
  }
  return null;
}
