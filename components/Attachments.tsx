"use client";

import { useRef, useState } from "react";

export interface AttachedImage {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string | null;
}

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const kb = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

/**
 * Images on a milestone, action item or roadblock.
 *
 * Used from the panel and from a share link. The two differ only in which
 * endpoint they post to, so the upload behaviour, limits and messages stay
 * identical wherever someone meets it.
 */
export default function Attachments({
  images, onUpload, onDelete, canDelete = true, compact = false,
}: {
  images: AttachedImage[];
  onUpload: (files: File[]) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  canDelete?: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<AttachedImage | null>(null);
  const [dragging, setDragging] = useState(false);

  async function take(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list);
    setError("");

    const room = MAX_FILES - images.length;
    if (room <= 0) {
      setError(`That already has ${MAX_FILES} images, which is the limit.`);
      return;
    }

    const rejected: string[] = [];
    const ok = files.filter((f) => {
      if (!ALLOWED.includes(f.type)) {
        rejected.push(`${f.name} isn't a JPG, PNG, GIF or WebP`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        rejected.push(`${f.name} is ${kb(f.size)} — the limit is 10 MB`);
        return false;
      }
      return true;
    });

    if (rejected.length) setError(rejected.join(". "));
    if (!ok.length) return;

    // Say plainly when we can't take them all, rather than dropping some quietly.
    const taking = ok.slice(0, room);
    if (ok.length > room) {
      setError((e) =>
        [e, `Only ${room} more will fit, so ${taking.length} of ${ok.length} were added.`]
          .filter(Boolean).join(" ")
      );
    }

    setBusy(true);
    try { await onUpload(taking); }
    catch (e: any) { setError(e.message ?? "That didn't upload."); }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <div className={`att ${compact ? "att-compact" : ""}`}>
      {images.length > 0 && (
        <div className="att-grid">
          {images.map((img) => (
            <div key={img.id} className="att-thumb">
              {img.url ? (
                <img
                  src={img.url}
                  alt={img.filename}
                  loading="lazy"
                  onClick={() => setViewing(img)}
                />
              ) : (
                <div className="att-missing">unavailable</div>
              )}
              <div className="att-meta" title={img.filename}>
                {img.filename}
                <span className="att-size">{kb(img.bytes)}</span>
              </div>
              {canDelete && onDelete && (
                <button
                  className="att-x"
                  title="Remove this image"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Remove ${img.filename}?`)) return;
                    await onDelete(img.id);
                  }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className={`att-drop ${dragging ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept={ALLOWED.join(",")}
          style={{ display: "none" }}
          onChange={(e) => take(e.target.files)}
        />
        {busy
          ? "Uploading…"
          : images.length
            ? `Add more — ${images.length} of ${MAX_FILES}`
            : "Add images — drop them here or click"}
      </div>

      {error && <div className="att-error">{error}</div>}

      {viewing?.url && (
        <div className="att-viewer" onClick={() => setViewing(null)}>
          <img src={viewing.url} alt={viewing.filename} onClick={(e) => e.stopPropagation()} />
          <div className="att-viewer-bar">
            <span>{viewing.filename}</span>
            <a href={viewing.url} target="_blank" rel="noreferrer"
               onClick={(e) => e.stopPropagation()}>Open full size</a>
          </div>
        </div>
      )}
    </div>
  );
}
