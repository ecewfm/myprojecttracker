"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Item {
  id: string; name: string; done: boolean; due_date?: string | null;
  assignee: string | null; mine: boolean; note?: string;
  depth?: number; child_total?: number; child_done?: number;
}
interface Block { id: string; title: string; detail: string; status: string; owner: string | null; raised_at: string }
interface Data {
  viewer: { id: string; name: string; email: string };
  project: {
    ref: string; title: string; status: string; phase: string | null;
    percent: number; due_date: string | null; owner: string | null;
    milestones: Item[]; tasks: Item[]; roadblocks: Block[];
  };
}

const RB_COLOR: Record<string, string> = {
  open: "#b8453a", progress: "#d97b1f", escalated: "#5f4f87", resolved: "#3f7a5c",
};
const RB_LABEL: Record<string, string> = {
  open: "Open", progress: "In progress", escalated: "Escalated", resolved: "Resolved",
};

export default function PublicProject() {
  const { token } = useParams<{ token: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [rb, setRb] = useState({ title: "", detail: "" });
  const [showRb, setShowRb] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/${token}`);
    if (!res.ok) { setDead(true); return; }
    setD(await res.json());
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function act(payload: any, msg: string) {
    // One in flight at a time — stops a double-tap creating two records.
    if (busy) return;
    setBusy(payload.id ?? payload.action);
    try {
      const res = await fetch(`/api/public/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { say(j.error ?? "That didn't go through."); }
      else { await load(); say(msg); }
    } catch { say("Something went wrong. Try again."); }
    setBusy(null);
  }

  if (dead) {
    return (
      <div className="pub-wrap">
        <div className="pub-card" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div className="pub-mark">ECE</div>
          <h1 style={{ fontSize: 18, marginTop: 18, marginBottom: 8 }}>This link is no longer active</h1>
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
            Ask whoever shared it with you for a new one.
          </p>
        </div>
      </div>
    );
  }

  if (!d) {
    return <div className="pub-wrap"><div className="pub-card"><div className="skeleton" style={{ height: 160 }} /></div></div>;
  }

  const p = d.project;
  const myTasks = p.tasks.filter((t) => t.mine && !t.done);
  const myMs = p.milestones.filter((m) => m.mine && !m.done);
  const mineCount = myTasks.length + myMs.length;
  // Progress counts parent milestones only, matching the board.
  const topLevel = p.milestones.filter((m) => (m.depth ?? 0) === 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="pub-wrap">
      <div className="pub-card">
        {/* header */}
        <div className="pub-mark">ECE</div>
        <h1 className="pub-title">{p.title}</h1>
        <div className="pub-meta">
          {p.ref} · {p.status}{p.phase ? ` · ${p.phase}` : ""}
          {p.owner ? ` · Owner: ${p.owner}` : ""}
        </div>

        <div className="pub-prog">
          <div className="pub-prog-top">
            <span className="pub-pct">{p.percent}%</span>
            <span className="pub-sub">
              {topLevel.filter((m) => m.done).length} of {topLevel.length} milestones
              {p.due_date ? ` · due ${p.due_date}` : ""}
            </span>
          </div>
          <div className="pub-track"><div className="pub-fill" style={{ width: `${p.percent}%` }} /></div>
        </div>

        {/* your items */}
        <div className="pub-you">
          <div className="pub-you-head">
            <span>Hi {d.viewer.name.split(" ")[0]}</span>
            <span className="pub-count">{mineCount === 0 ? "nothing open" : `${mineCount} open for you`}</span>
          </div>

          {mineCount === 0 && (
            <div className="pub-empty">
              Nothing is waiting on you right now. You can still raise a roadblock or leave a note below.
            </div>
          )}

          {myMs.map((m) => (
            <div key={m.id} className="pub-item mine">
              <div className="pub-item-main">
                <div className="pub-item-name">{m.name}</div>
                <div className="pub-item-tag">Milestone assigned to you</div>
              </div>
              <button
                className="pub-btn"
                disabled={busy === m.id}
                onClick={() => act({ action: "close_milestone", id: m.id }, "Marked complete. Thanks.")}
              >
                {busy === m.id ? "…" : "Mark done"}
              </button>
            </div>
          ))}

          {myTasks.map((t) => (
            <div key={t.id} className="pub-item mine">
              <div className="pub-item-main">
                <div className="pub-item-name">{t.name}</div>
                <div className="pub-item-tag">
                  Action item
                  {t.due_date ? <span style={{ color: t.due_date < today ? "#b8453a" : undefined }}> · due {t.due_date}</span> : null}
                </div>
              </div>
              <button
                className="pub-btn"
                disabled={busy === t.id}
                onClick={() => act({ action: "close_task", id: t.id }, "Closed. Thanks.")}
              >
                {busy === t.id ? "…" : "Mark done"}
              </button>
            </div>
          ))}
        </div>

        {/* raise a roadblock */}
        <div className="pub-sect">
          <div className="pub-sect-head">
            <span className="pub-sect-title">Blocked on something?</span>
            <button className="pub-link" onClick={() => setShowRb((s) => !s)}>
              {showRb ? "Cancel" : "Raise a roadblock"}
            </button>
          </div>
          {showRb && (
            <div className="pub-form">
              <input
                placeholder="What's blocking you?"
                value={rb.title}
                onChange={(e) => setRb({ ...rb, title: e.target.value })}
              />
              <textarea
                rows={3}
                placeholder="What have you tried, and what would unblock it?"
                value={rb.detail}
                onChange={(e) => setRb({ ...rb, detail: e.target.value })}
              />
              <button
                className="pub-btn solid"
                disabled={busy === "add_roadblock"}
                onClick={async () => {
                  await act({ action: "add_roadblock", ...rb }, "Raised. The project owner has been told.");
                  setRb({ title: "", detail: "" }); setShowRb(false);
                }}
              >
                Send it
              </button>
            </div>
          )}
        </div>

        {/* milestones — whole project */}
        <div className="pub-sect">
          <div className="pub-sect-title" style={{ marginBottom: 10 }}>Milestones</div>
          {p.milestones.map((m) => (
            <div
              key={m.id}
              className={`pub-row ${m.mine ? "mine" : ""} ${(m.depth ?? 0) > 0 ? "pub-sub" : ""}`}
            >
              <span className={`pub-check ${m.done ? "on" : ""}`}>{m.done ? "✓" : ""}</span>
              <div style={{ flex: 1 }}>
                <div className={`pub-row-name ${m.done ? "done" : ""}`}>
                  {m.name}
                  {(m.child_total ?? 0) > 0 && (
                    <span className="pub-kidcount">{m.child_done}/{m.child_total}</span>
                  )}
                </div>
                {m.assignee && <div className="pub-row-sub">{m.assignee}{m.mine ? " · you" : ""}</div>}
                {noteFor === m.id && (
                  <div className="pub-form" style={{ marginTop: 8 }}>
                    <textarea
                      rows={2} autoFocus
                      placeholder="Add context for this milestone…"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="pub-btn solid"
                        onClick={async () => {
                          await act({ action: "add_note", milestone_id: m.id, note: noteText }, "Note added.");
                          setNoteText(""); setNoteFor(null);
                        }}
                      >Save note</button>
                      <button className="pub-link" onClick={() => { setNoteFor(null); setNoteText(""); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              {noteFor !== m.id && (
                <button className="pub-link" onClick={() => { setNoteFor(m.id); setNoteText(""); }}>
                  Note
                </button>
              )}
            </div>
          ))}
        </div>

        {/* everyone's action items */}
        {p.tasks.length > 0 && (
          <div className="pub-sect">
            <div className="pub-sect-title" style={{ marginBottom: 10 }}>Action items</div>
            {p.tasks.map((t) => (
              <div key={t.id} className={`pub-row ${t.mine ? "mine" : ""}`}>
                <span className={`pub-check ${t.done ? "on" : ""}`}>{t.done ? "✓" : ""}</span>
                <div style={{ flex: 1 }}>
                  <div className={`pub-row-name ${t.done ? "done" : ""}`}>{t.name}</div>
                  <div className="pub-row-sub">
                    {t.assignee ?? "Unassigned"}{t.mine ? " · you" : ""}
                    {t.due_date ? ` · due ${t.due_date}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* roadblocks */}
        {p.roadblocks.length > 0 && (
          <div className="pub-sect">
            <div className="pub-sect-title" style={{ marginBottom: 10 }}>Roadblocks</div>
            {p.roadblocks.map((r) => (
              <div key={r.id} className="pub-rb" style={{ borderLeftColor: RB_COLOR[r.status] }}>
                <div className="pub-rb-top">
                  <span className="pub-rb-title">{r.title}</span>
                  <span className="pub-rb-status" style={{ color: RB_COLOR[r.status] }}>
                    {RB_LABEL[r.status]}
                  </span>
                </div>
                {r.detail && <div className="pub-rb-detail">{r.detail}</div>}
                <div className="pub-row-sub">{r.owner ?? "Unassigned"}</div>
              </div>
            ))}
          </div>
        )}

        <div className="pub-foot">
          Anything you submit here goes straight to the project owner.
        </div>
      </div>

      <div className={`pub-toast ${toast ? "on" : ""}`}>{toast}</div>
    </div>
  );
}
