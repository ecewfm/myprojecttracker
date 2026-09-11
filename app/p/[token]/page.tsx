"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { zoneToday } from "@/lib/tz";

interface Item {
  id: string; name: string; done: boolean; due_date?: string | null;
  assignee: string | null; mine: boolean; note?: string;
  depth?: number; child_total?: number; child_done?: number;
  parent_id?: string | null; parent_name?: string | null;
}
interface Block {
  id: string; title: string; detail: string; status: string;
  owner: string | null; raised_at: string;
  note?: string; mine?: boolean; target_date?: string | null;
}
interface Data {
  viewer: { id: string; name: string; email: string };
  project: {
    ref: string; title: string; status: string;
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


/**
 * Notes carry the context someone needs to act — scheduler, account size,
 * why a thing is stuck. They're also long enough to bury the list, so they
 * open on demand past a couple of lines.
 */
function Note({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;

  const long = text.length > 120;
  const shown = open || !long ? text : text.slice(0, 120).replace(/\s+\S*$/, "") + "…";

  return (
    <div className="pub-note">
      {shown}
      {long && (
        <button className="pub-note-more" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function InlineNote({
  value, onChange, onSave, onCancel, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  return (
    <div className="pub-form" style={{ marginTop: 8 }}>
      <textarea
        rows={2} autoFocus
        placeholder={placeholder ?? "Add context…"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="pub-btn solid" onClick={onSave}>Save note</button>
        <button className="pub-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

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

  /**
   * Group what's open for you so a step always sits under its parent.
   * A parent you aren't assigned still appears, greyed, as context — the
   * flat list made "Dashboard" look unrelated to "Billable Hours Dashboard
   * Initiative" when it is in fact one of its steps.
   */
  const myGroups = (() => {
    const byId = new Map(p.milestones.map((m) => [m.id, m]));
    const order: string[] = [];
    const groups = new Map<string, { key: string; parent: Item | null; children: Item[] }>();

    const slot = (key: string, parent: Item | null) => {
      if (!groups.has(key)) {
        groups.set(key, { key, parent, children: [] });
        order.push(key);
      }
      const g = groups.get(key)!;
      if (parent && !g.parent) g.parent = parent;
      return g;
    };

    for (const m of myMs) {
      if ((m.depth ?? 0) > 0 && m.parent_id) {
        slot(m.parent_id, byId.get(m.parent_id) ?? null).children.push(m);
      } else {
        slot(m.id, m);
      }
    }
    return order.map((k) => groups.get(k)!);
  })();
  // Progress counts parent milestones only, matching the board.
  const topLevel = p.milestones.filter((m) => (m.depth ?? 0) === 0);
  const today = zoneToday();

  return (
    <div className="pub-wrap">
      <div className="pub-card">
        {/* header */}
        <div className="pub-mark">ECE</div>
        <h1 className="pub-title">{p.title}</h1>
        <div className="pub-meta">
          {p.ref} · {p.status}
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

          {myGroups.map((g) => (
            <div key={g.key} className="pub-group">
              {/* The parent is shown whether or not it's assigned to you, so a
                  step never appears without the thing it belongs to. */}
              {g.parent && (
                <div className={`pub-item ${g.parent.mine ? "mine" : "context"}`}>
                  <div className="pub-item-main">
                    <div className="pub-item-name">{g.parent.name}</div>
                    <div className="pub-item-tag">
                      {g.parent.mine ? "Milestone assigned to you" : "Part of this milestone"}
                      {g.parent.child_total
                        ? ` · ${g.parent.child_done}/${g.parent.child_total} steps done`
                        : ""}
                    </div>
                    <Note text={g.parent.note ?? ""} />
                  </div>
                  {g.parent.child_total
                    ? <span className="pub-derived">Closes with its steps</span>
                    : g.parent.mine
                      ? <button
                          className="pub-btn"
                          disabled={busy === g.parent.id}
                          onClick={() => act({ action: "close_milestone", id: g.parent!.id }, "Marked complete. Thanks.")}
                        >{busy === g.parent.id ? "…" : "Mark done"}</button>
                      : null}
                </div>
              )}

              {g.children.map((m) => (
                <div key={m.id} className="pub-item mine pub-item-step">
                  <div className="pub-item-main">
                    <div className="pub-item-name">{m.name}</div>
                    <div className="pub-item-tag">Step assigned to you</div>
                    <Note text={m.note ?? ""} />
                    {noteFor === m.id && (
                      <InlineNote
                        value={noteText}
                        onChange={setNoteText}
                        onCancel={() => { setNoteFor(null); setNoteText(""); }}
                        onSave={async () => {
                          await act({ action: "add_note", milestone_id: m.id, note: noteText }, "Note added.");
                          setNoteText(""); setNoteFor(null);
                        }}
                      />
                    )}
                  </div>
                  <div className="pub-actions">
                    <button
                      className="pub-btn"
                      disabled={busy === m.id}
                      onClick={() => act({ action: "close_milestone", id: m.id }, "Marked complete. Thanks.")}
                    >{busy === m.id ? "…" : "Mark done"}</button>
                    <button className="pub-link" onClick={() => { setNoteFor(m.id); setNoteText(""); }}>
                      Note
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {myTasks.map((t) => (
            <div key={t.id} className="pub-item mine">
              <div className="pub-item-main">
                <div className="pub-item-name">{t.name}</div>
                <Note text={t.note ?? ""} />
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
          <div className="pub-sect-title" style={{ marginBottom: 10 }}>
            Milestones
            {p.milestones.some((m) => (m.depth ?? 0) > 0) && (
              <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: 8, color: "var(--ink-3)" }}>
                ({p.milestones.filter((m) => (m.depth ?? 0) > 0).length} sub-milestones)
              </span>
            )}
          </div>
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
                <Note text={m.note ?? ""} />
                {(m.assignee || m.due_date) && (
                  <div className="pub-row-sub">
                    {m.assignee}{m.mine ? " · you" : ""}
                    {m.due_date && (
                      <span style={{ color: !m.done && m.due_date < today ? "#b8453a" : undefined }}>
                        {m.assignee ? " · " : ""}due {m.due_date}
                      </span>
                    )}
                  </div>
                )}
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
                  <Note text={t.note ?? ""} />
                  <div className="pub-row-sub">
                    {t.assignee ?? "Unassigned"}{t.mine ? " · you" : ""}
                    {t.due_date && (
                      <span style={{ color: !t.done && t.due_date < today ? "#b8453a" : undefined }}>
                        {` · due ${t.due_date}`}
                      </span>
                    )}
                  </div>
                  {noteFor === t.id && (
                    <div className="pub-form" style={{ marginTop: 8 }}>
                      <textarea
                        rows={2} autoFocus
                        placeholder="Add context for this action item…"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="pub-btn solid"
                          onClick={async () => {
                            await act({ action: "add_note", task_id: t.id, note: noteText }, "Note added.");
                            setNoteText(""); setNoteFor(null);
                          }}
                        >Save note</button>
                        <button className="pub-link" onClick={() => { setNoteFor(null); setNoteText(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                {noteFor !== t.id && (
                  <button className="pub-link" onClick={() => { setNoteFor(t.id); setNoteText(""); }}>
                    Note
                  </button>
                )}
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
                  {r.mine ? (
                    // Owners set the status; everyone else sees it.
                    <select
                      className="pub-rb-select"
                      value={r.status}
                      style={{ color: RB_COLOR[r.status] }}
                      onChange={(e) => act(
                        { action: "set_roadblock_status", id: r.id, status: e.target.value },
                        e.target.value === "resolved"
                          ? "Resolved. Thanks — everyone waiting has been told."
                          : "Status updated."
                      )}
                    >
                      {Object.keys(RB_LABEL).map((k) => (
                        <option key={k} value={k}>{RB_LABEL[k]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="pub-rb-status" style={{ color: RB_COLOR[r.status] }}>
                      {RB_LABEL[r.status]}
                    </span>
                  )}
                </div>

                {r.detail && <div className="pub-rb-detail">{r.detail}</div>}
                <Note text={r.note ?? ""} />

                <div className="pub-rb-foot">
                  <span className="pub-row-sub">
                    {r.owner ?? "Unassigned"}
                    {r.mine ? " · you" : ""}
                    {r.target_date ? ` · target ${r.target_date}` : ""}
                  </span>
                  {noteFor !== r.id && (
                    <button className="pub-link" onClick={() => { setNoteFor(r.id); setNoteText(""); }}>
                      Add a note
                    </button>
                  )}
                </div>

                {noteFor === r.id && (
                  <InlineNote
                    value={noteText}
                    onChange={setNoteText}
                    placeholder={r.mine
                      ? "What's happened since — who you chased, what they said…"
                      : "Anything you know that helps — this goes to whoever owns it."}
                    onCancel={() => { setNoteFor(null); setNoteText(""); }}
                    onSave={async () => {
                      await act({ action: "roadblock_note", id: r.id, note: noteText }, "Note added.");
                      setNoteText(""); setNoteFor(null);
                    }}
                  />
                )}
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
