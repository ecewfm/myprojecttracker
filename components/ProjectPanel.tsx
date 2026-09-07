"use client";

import { useEffect, useState, useRef } from "react";
import { api, useToast } from "./Shell";
import {
  ROADBLOCK_STATUS, STATUS_COLUMNS,
  type Project, type Member, type RoadblockStatus, type ProjectStatus,
} from "@/lib/types";

/* ─────────── status dropdown ─────────── */
function StatusControl({
  value, onChange, disabled,
}: {
  value: RoadblockStatus;
  onChange: (s: RoadblockStatus) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const current = ROADBLOCK_STATUS[value];

  return (
    <div className="stat-ctl" ref={ref}>
      <button
        className="stat-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pip" style={{ background: current.color }} />
        {current.label}
        <span className="car">▾</span>
      </button>

      {open && (
        <div className="stat-menu" role="listbox">
          {(Object.keys(ROADBLOCK_STATUS) as RoadblockStatus[]).map((k) => (
            <button
              key={k}
              className="stat-opt"
              role="option"
              aria-selected={k === value}
              onClick={() => { setOpen(false); if (k !== value) onChange(k); }}
            >
              <span className="pip" style={{ background: ROADBLOCK_STATUS[k].color }} />
              {ROADBLOCK_STATUS[k].label}
              {k === value && <span className="tick-m">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── milestone with notes ─────────── */
function MilestoneRow({
  m, total, index, onToggle, onNote,
}: {
  m: { id: string; name: string; note: string; done: boolean };
  total: number; index: number;
  onToggle: (done: boolean) => void;
  onNote: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(m.note);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setNote(m.note), [m.note]);

  function edit(v: string) {
    setNote(v);
    setState("saving");
    clearTimeout(timer.current);
    // Debounced autosave — one write per pause, not per keystroke.
    timer.current = setTimeout(async () => {
      await onNote(v);
      setState("saved");
      setTimeout(() => setState("idle"), 1400);
    }, 700);
  }

  return (
    <div className={`ms-item ${open ? "open" : ""}`}>
      <div
        className="ms-head"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
      >
        <span
          className={`ms-box ${m.done ? "on" : ""}`}
          role="checkbox"
          aria-checked={m.done}
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggle(!m.done); }}
          onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggle(!m.done); } }}
        >
          {m.done ? "✓" : ""}
        </span>
        <span className={`ms-name ${m.done ? "on" : ""}`}>{m.name}</span>
        <span className="ms-flags">
          {note && <span className="ms-hasnote">Note</span>}
          <span>{index + 1}/{total}</span>
          <span className="ms-car">▸</span>
        </span>
      </div>

      {open && (
        <div className="ms-body">
          <label htmlFor={`note-${m.id}`}>Notes</label>
          <textarea
            id={`note-${m.id}`}
            value={note}
            placeholder="Decisions, context, what tripped this up…"
            onChange={(e) => edit(e.target.value)}
          />
          <div className="ms-body-foot">
            <span>
              {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : note ? "Saved" : "Empty"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── panel ─────────── */
export default function ProjectPanel({
  project, members, onClose, onChange,
}: {
  project: Project | null;
  members: Member[];
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [p, setP] = useState(project);
  const [showRbForm, setShowRbForm] = useState(false);
  const [rbDraft, setRbDraft] = useState({ title: "", detail: "", owner_id: "", status: "open" as RoadblockStatus });
  const [analysing, setAnalysing] = useState(false);
  const [meeting, setMeeting] = useState({ start: "", minutes: 30 });
  const [taskDraft, setTaskDraft] = useState({ name: "", assignee_id: "", due_date: "" });
  const [showTaskForm, setShowTaskForm] = useState(false);

  useEffect(() => setP(project), [project]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  if (!p) return null;

  const refresh = async () => {
    const fresh = await api<Project>(`/api/projects/${p.id}`);
    setP(fresh);
    onChange();
  };

  const column = STATUS_COLUMNS.find((c) => c.key === p.status);
  const doneCount = p.milestones.filter((m) => m.done).length;
  const openBlocks = p.roadblocks.filter((r) => r.status !== "resolved");
  const today = new Date().toISOString().slice(0, 10);

  /* ── actions ── */
  async function setRoadblockStatus(id: string, status: RoadblockStatus, was: RoadblockStatus) {
    try {
      await api(`/api/roadblocks/${id}`, { method: "PATCH", body: { status } });
      await refresh();
      if (status === "resolved" && was !== "resolved") toast("Resolved. Reminders for it stop here.");
      else if (status === "escalated") toast("Escalated. The owner and manager were messaged on Cliq.");
      else toast(`Status set to ${ROADBLOCK_STATUS[status].label.toLowerCase()}.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function addRoadblock() {
    if (!rbDraft.title.trim()) { toast("Give the roadblock a title.", "err"); return; }
    try {
      await api("/api/roadblocks", {
        method: "POST",
        body: { ...rbDraft, project_id: p!.id, owner_id: rbDraft.owner_id || null },
      });
      setRbDraft({ title: "", detail: "", owner_id: "", status: "open" });
      setShowRbForm(false);
      await refresh();
      toast("Roadblock logged. The owner has been messaged.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function toggleMilestone(id: string, done: boolean) {
    setP((prev) => prev && {
      ...prev,
      milestones: prev.milestones.map((m) => (m.id === id ? { ...m, done } : m)),
    });
    try {
      await api(`/api/milestones/${id}`, { method: "PATCH", body: { done } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); await refresh(); }
  }

  async function saveNote(id: string, note: string) {
    try {
      await api(`/api/milestones/${id}`, { method: "PATCH", body: { note } });
      setP((prev) => prev && {
        ...prev,
        milestones: prev.milestones.map((m) => (m.id === id ? { ...m, note } : m)),
      });
      onChange();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function toggleTask(id: string, done: boolean) {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: { done } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function addTask() {
    if (!taskDraft.name.trim()) { toast("Name the action item.", "err"); return; }
    try {
      await api("/api/tasks", {
        method: "POST",
        body: {
          project_id: p!.id,
          name: taskDraft.name,
          assignee_id: taskDraft.assignee_id || null,
          due_date: taskDraft.due_date || null,
        },
      });
      setTaskDraft({ name: "", assignee_id: "", due_date: "" });
      setShowTaskForm(false);
      await refresh();
      toast(taskDraft.assignee_id ? "Added. The assignee was messaged on Cliq." : "Action item added.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function changeStatus(status: ProjectStatus) {
    try {
      await api(`/api/projects/${p!.id}`, { method: "PATCH", body: { status } });
      await refresh();
      toast(`Moved to ${STATUS_COLUMNS.find((c) => c.key === status)?.label}.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function runAnalysis() {
    setAnalysing(true);
    try {
      await api("/api/analyze", { method: "POST", body: { project_id: p!.id } });
      await refresh();
      toast("Analysis updated.");
    } catch (e: any) { toast(e.message, "err"); }
    setAnalysing(false);
  }

  async function bookMeeting() {
    if (!meeting.start) { toast("Pick a date and time first.", "err"); return; }
    try {
      await api("/api/meetings", {
        method: "POST",
        body: { project_id: p!.id, start: new Date(meeting.start).toISOString(), minutes: meeting.minutes },
      });
      setMeeting({ start: "", minutes: 30 });
      toast("Meeting booked. Invites are out.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  const attendees = [p.owner, ...p.members].filter(Boolean) as Member[];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="panel on" role="dialog" aria-modal="true" aria-label={p.title}>
        <div className="panel-head">
          <div className="panel-meta">
            <span>{p.ref}</span><span>·</span><span>{column?.label}</span>
            {p.priority && <span className="lab lab-priority">Priority</span>}
            {p.shared && <span className="lab lab-shared">Shared</span>}
            {p.due_date && (
              <span className={`lab ${p.due_date < today ? "lab-late" : "lab-due"}`}>
                {p.due_date < today ? "Late" : "Due"} {p.due_date}
              </span>
            )}
            {p.labels.map((l) => (
              <span key={l.name} className="lab lab-custom"
                style={{ color: l.color, borderColor: l.color + "55", background: l.color + "20" }}>
                {l.name}
              </span>
            ))}
          </div>
          <div className="panel-title">{p.title}</div>
          <button className="panel-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="panel-body">
          {/* overview */}
          <div className="block">
            <div className="glass-inset">
              <div className="big-prog-top">
                <span className="big-prog-n">{p.percent}%</span>
                <span className="big-prog-sub">{doneCount} of {p.milestones.length} milestones</span>
              </div>
              <div className="big-track"><div className="big-fill" style={{ width: `${p.percent}%` }} /></div>

              <div className="rows" style={{ marginTop: 16 }}>
                <div className="row">
                  <span className="row-k">Owner</span>
                  <span className="row-v">{p.owner?.name ?? "Unassigned"}</span>
                </div>
                <div className="row">
                  <span className="row-k">Column</span>
                  <select value={p.status} onChange={(e) => changeStatus(e.target.value as ProjectStatus)}>
                    {STATUS_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="row">
                  <span className="row-k">Current phase</span>
                  <span className="row-v">{p.phase ?? "Not set"}</span>
                </div>
                <div className="row">
                  <span className="row-k">Open roadblocks</span>
                  <span className="row-v" style={{ color: openBlocks.length ? "var(--red)" : undefined }}>
                    {openBlocks.length || "None"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* roadblocks */}
          <div className="block">
            <div className="block-head">
              <span className="block-title">
                Roadblocks {p.roadblocks.length ? `· ${openBlocks.length} open` : ""}
              </span>
              <button className="block-act" onClick={() => setShowRbForm((s) => !s)}>
                {showRbForm ? "Cancel" : "Add roadblock"}
              </button>
            </div>

            {p.roadblocks.length === 0 && !showRbForm && (
              <div className="empty">Nothing is blocked. Log one when something stalls.</div>
            )}

            {p.roadblocks.map((r) => (
              <div key={r.id} className="rb" data-s={r.status}>
                <div className="rb-top">
                  <span className="rb-title">{r.title}</span>
                  <StatusControl
                    value={r.status}
                    onChange={(s) => setRoadblockStatus(r.id, s, r.status)}
                  />
                </div>
                {r.detail && <div className="rb-desc">{r.detail}</div>}
                <div className="rb-foot">
                  <span>{r.owner?.name ?? "Unassigned"}</span>
                  <span className="sep">·</span>
                  <span>Raised {new Date(r.raised_at).toLocaleDateString("en-PH")}</span>
                  {r.status !== "resolved" && (
                    <><span className="sep">·</span><span>Cliq nudge active</span></>
                  )}
                </div>
              </div>
            ))}

            {showRbForm && (
              <div className="rb-add">
                <input placeholder="What is blocking this?" value={rbDraft.title}
                  onChange={(e) => setRbDraft({ ...rbDraft, title: e.target.value })} />
                <textarea rows={3} placeholder="Detail, context, what has been tried"
                  value={rbDraft.detail}
                  onChange={(e) => setRbDraft({ ...rbDraft, detail: e.target.value })} />
                <div className="rb-add-row">
                  <select value={rbDraft.owner_id}
                    onChange={(e) => setRbDraft({ ...rbDraft, owner_id: e.target.value })}>
                    <option value="">Who owns it?</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select value={rbDraft.status}
                    onChange={(e) => setRbDraft({ ...rbDraft, status: e.target.value as RoadblockStatus })}>
                    {(Object.keys(ROADBLOCK_STATUS) as RoadblockStatus[]).map((k) => (
                      <option key={k} value={k}>{ROADBLOCK_STATUS[k].label}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-solid" onClick={addRoadblock}>Save roadblock</button>
              </div>
            )}
          </div>

          {/* AI */}
          <div className="block">
            <div className="block-head">
              <span className="block-title">Analysis</span>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {p.ai_ran_at ? `Gemini · ${new Date(p.ai_ran_at).toLocaleDateString("en-PH")}` : "Gemini"}
              </span>
            </div>
            <div className="ai">
              {p.ai_summary
                ? p.ai_summary.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)
                : <p>No analysis yet. Run it when you want a read on where this stands.</p>}
            </div>
            <div className="ai-foot">
              <button onClick={runAnalysis} disabled={analysing}>
                {analysing ? "Thinking…" : p.ai_summary ? "Refresh" : "Run analysis"}
              </button>
            </div>
          </div>

          {/* milestones */}
          <div className="block">
            <div className="block-head">
              <span className="block-title">
                Milestones · {doneCount}/{p.milestones.length}
              </span>
            </div>
            {p.milestones.map((m, i) => (
              <MilestoneRow
                key={m.id}
                m={m}
                index={i}
                total={p.milestones.length}
                onToggle={(done) => toggleMilestone(m.id, done)}
                onNote={(note) => saveNote(m.id, note)}
              />
            ))}
          </div>

          {/* subprojects */}
          {p.subprojects.length > 0 && (
            <div className="block">
              <div className="block-head"><span className="block-title">Subprojects</span></div>
              {p.subprojects.map((s) => (
                <div key={s.id} className="sub">
                  <div className="sub-top">
                    <span className="sub-name">{s.name}</span>
                    <span className="sub-who">{s.owner?.name ?? "Unassigned"}</span>
                  </div>
                  <div className="sub-bar">
                    <div className="prog-track"><div className="prog-fill" style={{ width: `${s.percent}%` }} /></div>
                    <span className="prog-n">{s.percent}%</span>
                  </div>
                  <div className="ticks" style={{ marginBottom: 0, marginTop: 9 }}>
                    {s.milestones.map((m) => (
                      <span key={m.id} className={`tick ${m.done ? "on" : m.note ? "note" : ""}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* tasks */}
          <div className="block">
            <div className="block-head">
              <span className="block-title">Action items</span>
              <button className="block-act" onClick={() => setShowTaskForm((s) => !s)}>
                {showTaskForm ? "Cancel" : "Add"}
              </button>
            </div>

            {p.tasks.length === 0 && !showTaskForm && (
              <div className="empty">No action items yet.</div>
            )}

            {p.tasks.map((t) => (
              <div key={t.id} className="task">
                <span
                  className={`task-box ${t.done ? "on" : ""}`}
                  role="checkbox" aria-checked={t.done} tabIndex={0}
                  onClick={() => toggleTask(t.id, !t.done)}
                  onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); toggleTask(t.id, !t.done); } }}
                >
                  {t.done ? "✓" : ""}
                </span>
                <span className={`task-name ${t.done ? "on" : ""}`}>{t.name}</span>
                <span className="task-who">{t.assignee?.name.split(" ")[0] ?? "—"}</span>
                <span className={`task-due ${!t.done && t.due_date && t.due_date < today ? "over" : ""}`}>
                  {t.due_date ?? ""}
                </span>
              </div>
            ))}

            {showTaskForm && (
              <div className="rb-add" style={{ marginTop: 8 }}>
                <input placeholder="What needs doing?" value={taskDraft.name}
                  onChange={(e) => setTaskDraft({ ...taskDraft, name: e.target.value })} />
                <div className="rb-add-row">
                  <select value={taskDraft.assignee_id}
                    onChange={(e) => setTaskDraft({ ...taskDraft, assignee_id: e.target.value })}>
                    <option value="">Assign to…</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="date" value={taskDraft.due_date}
                    onChange={(e) => setTaskDraft({ ...taskDraft, due_date: e.target.value })} />
                </div>
                <button className="btn btn-solid" onClick={addTask}>Add action item</button>
              </div>
            )}
          </div>

          {/* meeting */}
          <div className="block">
            <div className="block-head"><span className="block-title">Meeting</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
              {attendees.length
                ? `Attendees: ${attendees.map((a) => a.name).join(", ")}`
                : "Assign an owner first so there's someone to invite."}
            </div>
            <div className="inline-form">
              <input type="datetime-local" value={meeting.start}
                onChange={(e) => setMeeting({ ...meeting, start: e.target.value })} />
              <select value={meeting.minutes}
                onChange={(e) => setMeeting({ ...meeting, minutes: Number(e.target.value) })}>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
              </select>
              <button className="btn" onClick={bookMeeting} disabled={!attendees.length}>
                Schedule
              </button>
            </div>
          </div>

          {/* reminders */}
          <div className="block">
            <div className="block-head"><span className="block-title">Reminders</span></div>
            <div className="tog-row">
              <div>
                <div className="tog-k">Cliq reminders for this project</div>
                <div className="tog-sub">Daily, then twice daily as a deadline closes in</div>
              </div>
              <div
                className={`tog ${p.reminders_on ? "on" : ""}`}
                role="switch" aria-checked={p.reminders_on} tabIndex={0}
                onClick={async () => {
                  await api(`/api/projects/${p.id}`, {
                    method: "PATCH", body: { reminders_on: !p.reminders_on },
                  });
                  await refresh();
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
