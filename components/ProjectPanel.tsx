"use client";

import { useEffect, useState, useRef } from "react";
import { api, useToast } from "./Shell";
import {
  ROADBLOCK_STATUS, STATUS_COLUMNS,
  type Project, type Member, type Milestone, type RoadblockStatus, type ProjectStatus,
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
  m, total, index, members, onToggle, onNote, onRename, onAssign, onDelete,
}: {
  m: Milestone;
  total: number; index: number;
  members: Member[];
  onToggle: (done: boolean) => void;
  onNote: (note: string) => void;
  onRename: (name: string) => void;
  onAssign: (memberId: string | null) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(m.note);
  const [name, setName] = useState(m.name);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setNote(m.note), [m.note]);
  useEffect(() => setName(m.name), [m.name]);

  function edit(v: string) {
    setNote(v);
    setState("saving");
    clearTimeout(timer.current);
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
          {m.assignee && <span className="ms-hasnote" style={{ background: "rgba(29,43,35,.09)", color: "var(--ink-2)", borderColor: "var(--g-brd-2)" }}>{m.assignee.name.split(" ")[0]}</span>}
          {note && <span className="ms-hasnote">Note</span>}
          <span>{index + 1}/{total}</span>
          <span className="ms-car">▸</span>
        </span>
      </div>

      {open && (
        <div className="ms-body">
          <label htmlFor={`name-${m.id}`}>Name</label>
          <input
            id={`name-${m.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name !== m.name) onRename(name.trim()); }}
            style={{ width: "100%", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.55)", fontSize: 13, marginBottom: 12 }}
          />

          <label htmlFor={`assignee-${m.id}`}>Assigned to (optional)</label>
          <select
            id={`assignee-${m.id}`}
            value={m.assignee?.id ?? ""}
            onChange={(e) => onAssign(e.target.value || null)}
            style={{ width: "100%", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.55)", fontSize: 13, marginBottom: 12 }}
          >
            <option value="">No one</option>
            {members.map((mem) => <option key={mem.id} value={mem.id}>{mem.name}</option>)}
          </select>

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
            <button
              onClick={onDelete}
              style={{ marginLeft: "auto", color: "var(--red)" }}
            >
              Delete milestone
            </button>
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
  const [links, setLinks] = useState<any[]>([]);

  useEffect(() => setP(project), [project]);
  useEffect(() => {
    if (!project) { setLinks([]); return; }
    api(`/api/projects/${project.id}/links`).then(setLinks).catch(() => {});
  }, [project]);
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

  async function renameMilestone(id: string, name: string) {
    try {
      await api(`/api/milestones/${id}`, { method: "PATCH", body: { name } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function assignMilestone(id: string, memberId: string | null) {
    try {
      await api(`/api/milestones/${id}`, { method: "PATCH", body: { assignee_id: memberId } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function deleteMilestone(id: string) {
    if (!confirm("Delete this milestone?")) return;
    try {
      await api(`/api/milestones/${id}`, { method: "DELETE" });
      await refresh();
      toast("Milestone deleted.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function addMilestone() {
    const name = prompt("Milestone name");
    if (!name?.trim()) return;
    try {
      await api("/api/milestones", { method: "POST", body: { project_id: p!.id, name: name.trim() } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function deleteProject() {
    if (!confirm(`Delete "${p!.title}" permanently? This removes its milestones, roadblocks, tasks, and notes. It cannot be undone.`)) return;
    if (!confirm("Last check — this is irreversible. Delete it?")) return;
    try {
      await api(`/api/projects/${p!.id}`, { method: "DELETE" });
      toast("Project deleted.");
      onClose();
      onChange();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function addMember(memberId: string) {
    try {
      await api(`/api/projects/${p!.id}/members`, { method: "POST", body: { member_id: memberId } });
      await refresh();
      toast("Added to the project.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function removeMember(memberId: string) {
    try {
      await api(`/api/projects/${p!.id}/members`, { method: "DELETE", body: { member_id: memberId } });
      await refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function postCliqUpdate() {
    if (!p!.cliq_channel) { toast("Set a Cliq channel first.", "err"); return; }
    try {
      await api("/api/cliq-update", { method: "POST", body: { project_id: p!.id } });
      toast(`Update posted to #${p!.cliq_channel}.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function sendProjectEmailNow() {
    try {
      const r = await api<{ sent: boolean; reason?: string }>(
        `/api/projects/${p!.id}/email`, { method: "POST", body: {} }
      );
      toast(r.sent ? "Project email sent." : r.reason ?? "Nothing sent.", r.sent ? "ok" : "err");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function issueLink(memberId: string) {
    try {
      await api(`/api/projects/${p!.id}/links`, { method: "POST", body: { member_id: memberId } });
      setLinks(await api(`/api/projects/${p!.id}/links`));
      toast("Link ready. Copy it and send it over.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function revokeLink(memberId: string) {
    if (!confirm("Revoke this link? It stops working straight away.")) return;
    try {
      await api(`/api/projects/${p!.id}/links`, { method: "DELETE", body: { member_id: memberId } });
      setLinks(await api(`/api/projects/${p!.id}/links`));
      toast("Revoked.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/p/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast("Link copied."),
      () => toast(url, "err")
    );
  }

  async function saveProjectField(patch: Record<string, unknown>, note?: string) {
    try {
      await api(`/api/projects/${p!.id}`, { method: "PATCH", body: patch });
      await refresh();
      if (note) toast(note);
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
                  <select
                    value={p.owner?.id ?? ""}
                    onChange={(e) => saveProjectField(
                      { owner_id: e.target.value || null },
                      e.target.value ? "Owner set." : "Owner cleared."
                    )}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="row">
                  <span className="row-k">Column</span>
                  <select value={p.status} onChange={(e) => changeStatus(e.target.value as ProjectStatus)}>
                    {STATUS_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="row">
                  <span className="row-k">Name</span>
                  <input
                    defaultValue={p.title}
                    key={p.id + p.title}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== p.title) saveProjectField({ title: v }, "Renamed.");
                    }}
                    style={{ border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", borderRadius: 7, padding: "4px 8px", fontSize: 12, fontWeight: 500, textAlign: "right", maxWidth: 240 }}
                  />
                </div>
                <div className="row">
                  <span className="row-k">Current phase</span>
                  <input
                    defaultValue={p.phase ?? ""}
                    key={p.id + (p.phase ?? "")}
                    placeholder="Not set"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (p.phase ?? "")) saveProjectField({ phase: v || null }, "Phase updated.");
                    }}
                    style={{ border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", borderRadius: 7, padding: "4px 8px", fontSize: 12, fontWeight: 500, textAlign: "right", maxWidth: 240 }}
                  />
                </div>
                <div className="row">
                  <span className="row-k">Target date</span>
                  <input
                    type="date"
                    defaultValue={p.due_date ?? ""}
                    key={p.id + (p.due_date ?? "")}
                    onChange={(e) => saveProjectField(
                      { due_date: e.target.value || null },
                      e.target.value ? "Target date set." : "Target date cleared."
                    )}
                    style={{ border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", borderRadius: 7, padding: "4px 8px", fontSize: 12, fontWeight: 500 }}
                  />
                </div>
                <div className="row">
                  <span className="row-k">Priority</span>
                  <div
                    className={`tog ${p.priority ? "on" : ""}`}
                    role="switch" aria-checked={p.priority} tabIndex={0}
                    onClick={() => saveProjectField({ priority: !p.priority })}
                  />
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
              <button className="block-act" onClick={addMilestone}>Add</button>
            </div>
            {p.milestones.map((m, i) => (
              <MilestoneRow
                key={m.id}
                m={m}
                index={i}
                total={p.milestones.length}
                members={members}
                onToggle={(done) => toggleMilestone(m.id, done)}
                onNote={(note) => saveNote(m.id, note)}
                onRename={(name) => renameMilestone(m.id, name)}
                onAssign={(memberId) => assignMilestone(m.id, memberId)}
                onDelete={() => deleteMilestone(m.id)}
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

          {/* people on the project */}
          <div className="block">
            <div className="block-head"><span className="block-title">People</span></div>
            {p.owner && (
              <div className="task" style={{ marginBottom: 6 }}>
                <span className="task-name">{p.owner.name}</span>
                <span className="task-who">Owner</span>
              </div>
            )}
            {p.members.map((mem) => (
              <div key={mem.id} className="task" style={{ marginBottom: 6 }}>
                <span className="task-name">{mem.name}</span>
                <button
                  onClick={() => removeMember(mem.id)}
                  style={{ fontSize: 11, color: "var(--red)" }}
                >Remove</button>
              </div>
            ))}
            <div className="inline-form" style={{ marginTop: 8 }}>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { addMember(e.target.value); e.target.value = ""; } }}
                style={{ flex: 1, minWidth: 160 }}
              >
                <option value="">Add someone…</option>
                {members
                  .filter((mem) => mem.id !== p.owner?.id && !p.members.some((x) => x.id === mem.id))
                  .map((mem) => <option key={mem.id} value={mem.id}>{mem.name}</option>)}
              </select>
            </div>
          </div>

          {/* cliq channel */}
          <div className="block">
            <div className="block-head"><span className="block-title">Cliq channel</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10 }}>
              Post a status update — progress, roadblocks, and the Gemini summary — to a channel.
            </div>
            <div className="inline-form">
              <input
                placeholder="channel-name"
                defaultValue={p.cliq_channel ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim().replace(/^#/, "");
                  if (v !== (p.cliq_channel ?? "")) saveProjectField({ cliq_channel: v || null }, "Channel saved.");
                }}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button className="btn" onClick={postCliqUpdate} disabled={!p.cliq_channel}>
                Send update
              </button>
            </div>
          </div>

          {/* per-project weekly email */}
          <div className="block">
            <div className="block-head"><span className="block-title">Weekly email for this project</span></div>
            <div className="tog-row">
              <div>
                <div className="tog-k">Send a weekly email for this project</div>
                <div className="tog-sub">Separate from the portfolio digest</div>
              </div>
              <div
                className={`tog ${p.email_enabled ? "on" : ""}`}
                role="switch" aria-checked={p.email_enabled} tabIndex={0}
                onClick={() => saveProjectField({ email_enabled: !p.email_enabled })}
              />
            </div>

            {p.email_enabled && (
              <div style={{ marginTop: 12 }}>
                <div className="fld-2" style={{ marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>Day</label>
                    <select
                      defaultValue={p.email_day}
                      onChange={(e) => saveProjectField({ email_day: Number(e.target.value) })}
                      style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13 }}
                    >
                      {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d,i) =>
                        <option key={d} value={i+1}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>Time (Manila)</label>
                    <select
                      defaultValue={p.email_hour}
                      onChange={(e) => saveProjectField({ email_hour: Number(e.target.value) })}
                      style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13 }}
                    >
                      {[7,8,9,10,16,17].map((h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                    </select>
                  </div>
                </div>

                <label style={{ fontSize: 12, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>To</label>
                <textarea
                  rows={2}
                  defaultValue={(p.email_to ?? []).join(", ")}
                  placeholder="name@ececontactcenters.com, another@ece.com"
                  onBlur={(e) => saveProjectField({ email_to: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                  style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13, marginBottom: 10, resize: "vertical" }}
                />

                <label style={{ fontSize: 12, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>CC</label>
                <textarea
                  rows={2}
                  defaultValue={(p.email_cc ?? []).join(", ")}
                  placeholder="optional"
                  onBlur={(e) => saveProjectField({ email_cc: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                  style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13, marginBottom: 10, resize: "vertical" }}
                />

                <label style={{ fontSize: 12, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>Subject</label>
                <input
                  defaultValue={p.email_subject ?? "{project}_Weekly update {date}"}
                  onBlur={(e) => saveProjectField({ email_subject: e.target.value })}
                  style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13, marginBottom: 6 }}
                />
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 12 }}>
                  {"{project}"} becomes the project name, {"{date}"} becomes the send date (MM/DD/YYYY).
                  Preview: <b>{(p.email_subject ?? "{project}_Weekly update {date}").replace(/{project}/g, p.title).replace(/{date}/g, new Date().toLocaleDateString("en-US"))}</b>
                </div>

                <button className="btn" onClick={sendProjectEmailNow}>Send one now</button>
              </div>
            )}
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

          {/* share links */}
          <div className="block">
            <div className="block-head"><span className="block-title">Share links</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12, lineHeight: 1.6 }}>
              Each person gets their own link. They see the whole project with their
              own items highlighted, and can close those, raise a roadblock, or leave
              a note. They can&rsquo;t delete anything or reach another project.
            </div>

            {links.filter((l) => !l.revoked).map((l) => (
              <div key={l.id} className="task" style={{ marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{l.member?.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {l.open_count > 0
                      ? `Opened ${l.open_count}\u00d7 · last ${new Date(l.last_opened_at).toLocaleDateString("en-PH")}`
                      : "Not opened yet"}
                  </div>
                </div>
                <button className="block-act" onClick={() => copyLink(l.token)}>Copy</button>
                <button
                  className="block-act"
                  onClick={() => revokeLink(l.member.id)}
                  style={{ color: "var(--red)" }}
                >Revoke</button>
              </div>
            ))}

            {links.filter((l) => !l.revoked).length === 0 && (
              <div className="empty">No links yet.</div>
            )}

            <div className="inline-form" style={{ marginTop: 10 }}>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { issueLink(e.target.value); e.target.value = ""; } }}
                style={{ flex: 1, minWidth: 180 }}
              >
                <option value="">Create a link for…</option>
                {members
                  .filter((m) => !links.some((l) => !l.revoked && l.member?.id === m.id))
                  .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* danger zone */}
          <div className="block">
            <div className="block-head"><span className="block-title">Delete project</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
              Permanently removes this project and everything in it. This can't be undone.
            </div>
            <button
              className="btn"
              onClick={deleteProject}
              style={{ color: "var(--red)", borderColor: "rgba(184,69,58,.4)" }}
            >
              Delete this project
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
