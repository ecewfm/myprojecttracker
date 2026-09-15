"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import { formatInZone } from "@/lib/tz";

interface Row {
  id: string;
  kind: string;
  group: "dm" | "digest" | "error" | "other";
  summary: string;
  at: string;
  project: { id: string; ref: string; title: string } | null;
  detail: {
    to?: string; email?: string; project?: string; trigger?: string;
    items?: string[]; body?: string; error?: string;
    recipients?: string[]; subject?: string;
  } | null;
}

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "dm", label: "Cliq DMs" },
  { key: "digest", label: "Emails" },
  { key: "error", label: "Failures" },
  { key: "other", label: "Everything else" },
] as const;

function Inner() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [group, setGroup] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (g: string) => {
    setLoading(true);
    try {
      const r = await api<{ rows: Row[]; next: string | null }>(`/api/activity?group=${g}`);
      setRows(r.rows);
      setNext(r.next);
      setOpen(null);
    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(group); }, [group, load]);
  useEffect(() => {
    api<Record<string, number>>("/api/activity", { method: "POST" })
      .then(setCounts).catch(() => {});
  }, []);

  async function more() {
    if (!next) return;
    try {
      const r = await api<{ rows: Row[]; next: string | null }>(
        `/api/activity?group=${group}&before=${encodeURIComponent(next)}`
      );
      setRows((prev) => [...prev, ...r.rows]);
      setNext(r.next);
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div id="shell">
      <TopBar />
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="page-card">
          <h2>Activity</h2>
          <div className="page-sub">
            Everything the automations have done. Click any line to see what was actually sent.
          </div>

          <div className="act-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`act-chip ${group === f.key ? "on" : ""}`}
                onClick={() => setGroup(f.key)}
              >
                {f.label}
                {counts[f.key] !== undefined && <span className="act-n">{counts[f.key]}</span>}
              </button>
            ))}
          </div>

          {loading && <div className="skeleton" style={{ height: 120 }} />}

          {!loading && rows.length === 0 && (
            <div className="empty">Nothing logged under this filter yet.</div>
          )}

          {rows.map((r) => (
            <div key={r.id} className={`act-row ${open === r.id ? "open" : ""}`}>
              <div
                className="act-head"
                role="button" tabIndex={0}
                onClick={() => setOpen(open === r.id ? null : r.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpen(open === r.id ? null : r.id); }}
              >
                <span className={`act-dot ${r.group}`} />
                <div className="act-main">
                  <div className="act-t">{r.summary}</div>
                  <div className="act-m">
                    <span className="act-kind">{r.group === "error" ? "failed" : r.group}</span>
                    <span>{formatInZone(r.at)}</span>
                    {r.project && <span>· {r.project.title}</span>}
                  </div>
                </div>
                <span className="act-car">▸</span>
              </div>

              {open === r.id && (
                <div className="act-detail">
                  {r.detail ? (
                    <>
                      <dl className="act-dl">
                        <dt>When</dt><dd>{formatInZone(r.at)}</dd>
                        {r.detail.to && (<><dt>Sent to</dt><dd>{r.detail.to}{r.detail.email ? ` · ${r.detail.email}` : ""}</dd></>)}
                        {r.detail.recipients && (<><dt>Sent to</dt><dd>{r.detail.recipients.join(", ")}</dd></>)}
                        <dt>Project</dt><dd>{r.project?.title ?? r.detail.project ?? "—"}</dd>
                        {r.detail.trigger && (<><dt>Why it fired</dt><dd>{r.detail.trigger}</dd></>)}
                        {r.detail.items?.length ? (
                          <><dt>Covered</dt><dd>{r.detail.items.join(" · ")}</dd></>
                        ) : null}
                      </dl>

                      {r.detail.error && <div className="act-err">{r.detail.error}</div>}
                      {r.detail.body && <div className="act-msg">{r.detail.body}</div>}
                    </>
                  ) : (
                    <>
                      <dl className="act-dl">
                        <dt>When</dt><dd>{formatInZone(r.at)}</dd>
                        <dt>Project</dt><dd>{r.project?.title ?? "—"}</dd>
                        <dt>Type</dt><dd>{r.kind}</dd>
                      </dl>
                      <div className="act-none">
                        This entry predates detailed logging, so only the summary was stored.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {next && !loading && (
            <button className="btn" style={{ marginTop: 12 }} onClick={more}>
              Load older
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
