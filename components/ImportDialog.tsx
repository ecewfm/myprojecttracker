"use client";

import { useState, useRef } from "react";
import { useToast } from "./Shell";

interface Change {
  kind: string; action: string; label: string; detail?: string;
}
interface Preview {
  projectId: string | null;
  projectTitle: string;
  creatingProject: boolean;
  changes: Change[];
  newPeople: string[];
  warnings: string[];
  newlyAssigned: { email: string; item: string }[];
  counts: Record<string, number>;
}
interface Result {
  created: number; updated: number; deleted: number;
  peopleAdded: string[]; notified: number; problems: string[];
}

const KIND_WORD: Record<string, string> = {
  milestone: "milestone", task: "action item",
  roadblock: "roadblock", project: "project", person: "person",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : word.endsWith("item") ? "s" : "s"}`;
}

/**
 * Read a response that might not be JSON. When a function times out or
 * crashes, the platform returns an HTML error page — parsing that as JSON
 * produced the useless "Unexpected token" message people were seeing.
 */
async function readResponse(res: Response, fallback: string) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json.error ?? fallback);
    return json;
  } catch (e: any) {
    if (e instanceof SyntaxError) {
      throw new Error(
        res.status === 504 || /timeout|FUNCTION_INVOCATION/i.test(text)
          ? "The import took too long and was cut off. Nothing was saved — try splitting the file into smaller chunks."
          : `${fallback} (server returned ${res.status})`
      );
    }
    throw e;
  }
}

export default function ImportDialog({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);

  async function runPreview(f: File) {
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "preview");
      const res = await fetch("/api/import", { method: "POST", body: fd });
      setPreview(await readResponse(res, "That file couldn't be read."));
    } catch (e: any) {
      toast(e.message, "err");
      setFile(null);
    }
    setBusy(false);
  }

  async function apply() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", "apply");
      fd.append("notify", String(notify));
      const res = await fetch("/api/import", { method: "POST", body: fd });
      setResult(await readResponse(res, "The import failed."));
      onDone();
    } catch (e: any) {
      toast(e.message, "err");
    }
    setBusy(false);
  }

  const counts = preview?.counts ?? {};
  /** Duplicate IDs would destroy rows, so the import can't proceed. */
  const blocked = !!preview?.warnings.some((w) => w.includes("share the ID"));

  const summaryLine = (action: string) =>
    Object.entries(counts)
      .filter(([k]) => k.startsWith(action + "_"))
      .map(([k, n]) => `${n} ${KIND_WORD[k.split("_")[1]] ?? k.split("_")[1]}${n === 1 ? "" : "s"}`)
      .join(", ");

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="imp" role="dialog" aria-modal="true" aria-label="Import a project">
        <div className="imp-head">
          <h3>Import from Excel</h3>
          <button className="panel-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="imp-body">
          {/* ── result ── */}
          {result ? (
            <div className="imp-done">
              <div className="imp-done-h">Import finished</div>
              <ul className="imp-list">
                {result.created > 0 && <li>{result.created} created</li>}
                {result.updated > 0 && <li>{result.updated} updated</li>}
                {result.deleted > 0 && <li>{result.deleted} deleted</li>}
                {result.peopleAdded.length > 0 && (
                  <li>{result.peopleAdded.length} added to the team: {result.peopleAdded.join(", ")}</li>
                )}
                {result.notified > 0 && <li>{result.notified} Cliq message(s) sent</li>}
              </ul>
              {result.problems.length > 0 && (
                <div className="imp-warn">
                  <b>Some rows had problems</b>
                  <ul>{result.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
              <button className="btn btn-solid" onClick={onClose}>Done</button>
            </div>

          /* ── preview ── */
          ) : preview ? (
            <>
              <div className="imp-target">
                {preview.creatingProject
                  ? <>This creates a new project: <b>{preview.projectTitle}</b></>
                  : <>Updating <b>{preview.projectTitle}</b></>}
              </div>

              {preview.warnings.length > 0 && (
                <div className={`imp-warn ${blocked ? "stop" : ""}`}>
                  {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}

              <div className="imp-counts">
                {summaryLine("create") && (
                  <div><span className="imp-tag create">Create</span>{summaryLine("create")}</div>
                )}
                {summaryLine("update") && (
                  <div><span className="imp-tag update">Update</span>{summaryLine("update")}</div>
                )}
                {summaryLine("delete") && (
                  <div><span className="imp-tag delete">Delete</span>{summaryLine("delete")}</div>
                )}
                {preview.changes.length === 0 && (
                  <div className="imp-none">Nothing in this file would change anything.</div>
                )}
              </div>

              {preview.newPeople.length > 0 && (
                <div className="imp-people">
                  <b>{preview.newPeople.length} new {preview.newPeople.length === 1 ? "person" : "people"} will be added to your team</b>
                  <div className="imp-emails">{preview.newPeople.join(", ")}</div>
                  <div className="imp-hint">
                    Check these for typos. A misspelled address becomes a real team
                    member whose Cliq messages will silently fail.
                  </div>
                </div>
              )}

              {preview.changes.length > 0 && (
                <details className="imp-detail">
                  <summary>See every change ({preview.changes.length})</summary>
                  <ul>
                    {preview.changes.map((c, i) => (
                      <li key={i}>
                        <span className={`imp-tag ${c.action}`}>{c.action}</span>
                        {c.label}
                        {c.detail && <span className="imp-sub"> · {c.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.newlyAssigned.length > 0 && (
                <div className="imp-notify">
                  <label className="imp-check">
                    <span className={`ms-box ${notify ? "on" : ""}`} onClick={() => setNotify(!notify)}>
                      {notify ? "✓" : ""}
                    </span>
                    <span>
                      <b>Send Cliq messages for {preview.newlyAssigned.length} new assignment
                        {preview.newlyAssigned.length === 1 ? "" : "s"}</b>
                      <div className="imp-hint">
                        Off by default. Turning this on messages each person once per item
                        they've been newly assigned.
                      </div>
                    </span>
                  </label>
                </div>
              )}

              <div className="imp-actions">
                <button className="btn" onClick={() => { setPreview(null); setFile(null); }}>
                  Choose another file
                </button>
                <button
                  className="btn btn-solid"
                  disabled={busy || blocked || preview.changes.length === 0}
                  onClick={apply}
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
            </>

          /* ── pick a file ── */
          ) : (
            <>
              <p className="imp-intro">
                Upload a workbook exported from a project, or the blank template.
                Rows with an ID are updated, rows without are created, and nothing
                is removed unless you put DELETE in the Action column.
              </p>

              <button
                className="imp-drop"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? "Reading the file…" : file ? file.name : "Choose an .xlsx file"}
              </button>

              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); runPreview(f); }
                }}
              />

              <a className="imp-tmpl" href="/api/template">
                Download the blank template
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );
}
