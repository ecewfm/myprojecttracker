/**
 * Turns the Markdown the model writes into email-safe HTML.
 *
 * Gemini reliably answers with `### headings`, `**bold**` and `* bullets`
 * whatever the prompt asks for. The digest used to drop each line into a
 * paragraph, so recipients saw the raw asterisks. This renders it properly
 * using table-based markup, because Outlook doesn't lay out `<ul>` reliably.
 *
 * Deliberately small: headings, bullets, bold, italic. Anything else passes
 * through as a paragraph rather than being mangled.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline marks, applied after escaping so the tags survive. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#16241d;">$1</b>')
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s.,;:)]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:12px;">$1</code>');
}

function bulletRow(text: string, last: boolean) {
  const pad = last ? "0" : "0 0 8px";
  return `<tr>
    <td valign="top" style="padding:0 9px ${last ? "0" : "8px"} 0;color:#3f7a5c;font-size:14px;line-height:1.55;">&bull;</td>
    <td valign="top" style="padding:${pad};font-size:13.5px;line-height:1.6;color:#3d5249;">${inline(text)}</td>
  </tr>`;
}

export function renderMarkdown(md: string): string {
  if (!md?.trim()) return "";

  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    const rows = bullets
      .map((b, i) => bulletRow(b, i === bullets.length - 1))
      .join("");
    out.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">${rows}</table>`
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) { flush(); continue; }

    // Headings: ### Executive Summary
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const size = h[1].length <= 2 ? 15 : 14;
      out.push(
        `<div style="font-size:${size}px;font-weight:600;color:#16241d;margin:14px 0 9px;">${inline(h[2])}</div>`
      );
      continue;
    }

    // Bullets: "* text", "- text", "• text"
    const b = line.match(/^[*\-•]\s+(.*)$/);
    if (b) { bullets.push(b[1]); continue; }

    // A line that is only bold — the model uses this as a subheading
    const strongOnly = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (strongOnly) {
      flush();
      out.push(
        `<div style="font-size:14px;font-weight:600;color:#16241d;margin:14px 0 8px;">${esc(strongOnly[1])}</div>`
      );
      continue;
    }

    flush();
    out.push(
      `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.65;color:#3d5249;">${inline(line)}</p>`
    );
  }

  flush();
  return out.join("");
}

/** The first line, stripped of Markdown — useful for a subject line. */
export function plainFirstLine(md: string): string {
  const first = (md ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return first.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").replace(/[*_`]/g, "");
}
