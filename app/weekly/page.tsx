"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";

interface Row {
  projectId: string; project: string; description: string;
  headline: string; impact: string; mine: boolean;
  percent: number | null; status: string;
}
interface Block { memberId: string; name: string; note: string; rows: Row[] }

const TONE: Record<string, string> = {
  Blocked: "red", Behind: "red",
  "For testing": "amber", "In progress": "amber",
  "On track": "green", Complete: "green",
};

/** Click to edit, click away to save. Uncontrolled while editing. */
function Cell({
  value, placeholder, mine, onSave,
}: {
  value: string; placeholder: string; mine: boolean; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (editing) {
    return (
      <div className="wk-ed editing">
        <textarea
          autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft.trim() !== value) onSave(draft.trim()); }}
        />
      </div>
    );
  }
  return (
    <div className={`wk-ed ${value ? "" : "empty"}`} role="button" tabIndex={0}
         onClick={() => setEditing(true)}
         onKeyDown={(e) => { if (e.key === "Enter") setEditing(true); }}>
      {value || placeholder}
      {mine && value && <span className="wk-mine">yours</span>}
    </div>
  );
}

function Inner() {
  const toast = useToast();
  const [people, setPeople] = useState<Block[]>([]);
  const [idle, setIdle] = useState<string[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [mail, setMail] = useState<{ subject: string; html: string } | null>(null);
  const [mailBusy, setMailBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ people: Block[]; idle: string[]; unassigned: number }>("/api/people-update");
      setPeople(r.people); setIdle(r.idle); setUnassigned(r.unassigned); setErr("");
    } catch (e: any) { setErr(e.message); toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function save(memberId: string, projectId: string, patch: { headline?: string; impact?: string }) {
    setPeople((prev) => prev.map((b) => b.memberId !== memberId ? b : {
      ...b,
      rows: b.rows.map((r) => r.projectId !== projectId ? r : { ...r, ...patch, mine: true }),
    }));
    try { await api("/api/people-update", { method: "PATCH", body: { memberId, projectId, ...patch } }); }
    catch (e: any) { toast(e.message, "err"); await load(); }
  }

  async function draft() {
    setDrafting(true);
    try {
      const r = await api<{ written: number; skipped: number }>("/api/people-update", { method: "POST" });
      toast(`${r.written} line${r.written === 1 ? "" : "s"} drafted` +
            (r.skipped ? `, ${r.skipped} left as yours.` : "."));
      await load();
    } catch (e: any) { toast(e.message, "err"); }
    setDrafting(false);
  }

  async function preview() {
    setMailBusy(true);
    try { setMail(await api<{ subject: string; html: string }>("/api/digest/preview")); }
    catch (e: any) { toast(e.message, "err"); }
    setMailBusy(false);
  }

  async function send() {
    setMail(null);
    try {
      const r = await api<{ sent: number }>("/api/digest/preview", { method: "POST" });
      toast(`Sent to ${r.sent} recipient${r.sent === 1 ? "" : "s"}.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div id="shell">
      <TopBar />
      <div className="wk-wrap">
        <div className="wk-panel">
          <div className="wk-head">
            <div>
              <h2>Weekly update</h2>
              <p>
                Who's working on what, what it does for the business, and where it stands.
                Click any line to reword it — your version is kept.
              </p>
            </div>
            <div className="wk-head-r">
              <button className="btn" onClick={draft} disabled={drafting}>
                {drafting ? "Drafting…" : "Draft with AI"}
              </button>
              <a className="btn" href="/api/people-update/export" download>Export to Excel</a>
              <button className="btn btn-solid" onClick={preview} disabled={mailBusy}>
                {mailBusy ? "Building…" : "Weekly email"}
              </button>
            </div>
          </div>

          {loading && <div className="skeleton" style={{ height: 150, margin: "0 20px 20px" }} />}
          {!loading && err && <div className="wk-err">{err}</div>}

          {!loading && !err && (
            <div className="wk-scroll">
              <table className="wk-table">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Programmer</th>
                    <th style={{ width: 190 }}>Currently working on</th>
                    <th>How it's impacting the business</th>
                    <th style={{ width: 74 }}>Complete</th>
                    <th style={{ width: 96 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((b) => (
                    <Fragment key={b.memberId}>
                      {b.rows.map((r, i) => (
                        <tr key={r.projectId} className={i === b.rows.length - 1 ? "last" : ""}>
                          {i === 0 && (
                            <td rowSpan={b.rows.length} className="wk-who">
                              <div className="wk-name">{b.name}</div>
                              <div className="wk-note">{b.note}</div>
                            </td>
                          )}
                          <td>
                            <Cell
                              value={r.headline}
                              placeholder="What they're working on…"
                              mine={r.mine}
                              onSave={(v) => save(b.memberId, r.projectId, { headline: v })}
                            />
                            {r.description && <div className="wk-desc">{r.description}</div>}
                          </td>
                          <td>
                            <Cell
                              value={r.impact}
                              placeholder="No line yet — press Draft with AI"
                              mine={r.mine}
                              onSave={(v) => save(b.memberId, r.projectId, { impact: v })}
                            />
                          </td>
                          <td className="wk-pct">
                            {r.percent === null ? <span className="wk-dash">—</span> : (
                              <>
                                <div className="wk-pctn">{r.percent}%</div>
                                <div className="wk-track">
                                  <div className={`wk-fill ${r.percent < 40 ? "low" : ""}`}
                                       style={{ width: `${Math.max(r.percent, 2)}%` }} />
                                </div>
                              </>
                            )}
                          </td>
                          <td>
                            <span className={`wk-st ${TONE[r.status] ?? "amber"}`}>{r.status}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="wk-foot">
            {unassigned > 0 && (
              <div className="wk-warn">
                <b>{unassigned} items have nobody assigned.</b> Nothing is reminding anyone about them.
              </div>
            )}
            {idle.length > 0 && (
              <div className="wk-idle">Nothing open this week: {idle.join(", ")}.</div>
            )}
          </div>
        </div>
      </div>

      {mail && (
        <div className="mail-scrim" onClick={(e) => { if (e.target === e.currentTarget) setMail(null); }}>
          <div className="mail-box">
            <div className="mail-bar">
              <div>
                <div className="mail-t1">{mail.subject}</div>
                <div className="mail-t2">This is a preview — nothing has been sent.</div>
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <button className="btn" onClick={() => setMail(null)}>Cancel</button>
                <button className="btn btn-solid" onClick={send}>Send now</button>
              </div>
            </div>
            <div className="mail-body" dangerouslySetInnerHTML={{ __html: mail.html }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
