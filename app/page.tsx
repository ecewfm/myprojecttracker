"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import ProjectPanel from "@/components/ProjectPanel";
import ImportDialog from "@/components/ImportDialog";
import { STATUS_COLUMNS, type Project, type Member, type ProjectStatus } from "@/lib/types";
import type { ProjectSummary } from "@/lib/data";
import { zoneToday } from "@/lib/tz";

function Card({
  p, onOpen, onDuplicate, onDelete,
}: {
  p: ProjectSummary;
  onOpen: () => void;
  onDuplicate: (p: ProjectSummary) => void;
  onDelete: (p: ProjectSummary) => void;
}) {
  const open = p.openRoadblocks;
  const today = zoneToday();
  const late = p.due_date && p.due_date < today && p.percent < 100;

  return (
    <button
      className={`card ${open ? "blocked" : ""}`}
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {/* Hidden until hover so the board reads the same at rest. */}
      <span className="card-acts">
        <span
          className="icon-act"
          role="button" tabIndex={0} title="Duplicate this project"
          onClick={(e) => { e.stopPropagation(); onDuplicate(p); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onDuplicate(p); } }}
        >⧉</span>
        <span
          className="icon-act del"
          role="button" tabIndex={0} title="Delete this project"
          onClick={(e) => { e.stopPropagation(); onDelete(p); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onDelete(p); } }}
        >🗑</span>
      </span>

      <div className="card-top">
        <span className="card-name">{p.title}</span>
        <span className="card-ref">{p.ref}</span>
      </div>
      <div className="card-who">
        {[p.owner, ...p.members].filter(Boolean).map((m) => m!.name).join(", ") || "Unassigned"}
      </div>

      {(p.priority || p.shared || p.due_date || p.labels.length > 0) && (
        <div className="labels">
          {p.priority && <span className="lab lab-priority">Priority</span>}
          {p.shared && <span className="lab lab-shared">Shared</span>}
          {p.due_date && (
            <span className={`lab ${late ? "lab-late" : "lab-due"}`}>
              {late ? "Late" : "Due"} {p.due_date.slice(5)}
            </span>
          )}
          {p.labels.map((l) => (
            <span key={l.name} className="lab lab-custom"
              style={{ color: l.color, borderColor: l.color + "55", background: l.color + "20" }}>
              {l.name}
            </span>
          ))}
        </div>
      )}

      {open > 0 && (
        <div className="flag">
          <span className="pip" />
          {open} roadblock{open > 1 ? "s" : ""}
        </div>
      )}

      <div className="prog">
        <div className="prog-track"><div className="prog-fill" style={{ width: `${p.percent}%` }} /></div>
        <span className="prog-n">{p.percent}%</span>
      </div>

      <div className="ticks">
        {p.milestones.filter((m) => !m.sub).map((m) => (
          <span key={m.id} className={`tick ${m.done ? "on" : m.hasNote ? "note" : ""}`} />
        ))}
      </div>

    </button>
  );
}

function BoardInner() {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ps, ms] = await Promise.all([
        api<ProjectSummary[]>("/api/projects"),
        api<Member[]>("/api/team"),
      ]);
      setProjects(ps);
      setMembers(ms);

    } catch (e: any) {
      toast(e.message, "err");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function newProject() {
    const title = prompt("Project name");
    if (!title?.trim()) return;
    try {
      await api("/api/projects", { method: "POST", body: { title: title.trim() } });
      await load();
      toast("Project created with the standard ten milestones.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  /** The card only holds a summary; load the full project when it opens. */
  async function openProject(id: string) {
    setOpening(id);
    try {
      setSelected(await api<Project>(`/api/projects/${id}`));
    } catch (e: any) { toast(e.message, "err"); }
    setOpening(null);
  }

  async function moveProject(id: string, status: string) {
    const proj = projects.find((x) => x.id === id);
    if (!proj || proj.status === status) return;

    // Move it on screen first; the write follows. A failure reloads the truth.
    setProjects((prev) =>
      prev.map((x) => (x.id === id ? { ...x, status: status as ProjectStatus } : x))
    );
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", body: { status } });
      await load();
    } catch (e: any) {
      toast(e.message, "err");
      await load();
    }
  }

  async function duplicate(p: ProjectSummary) {
    try {
      await api(`/api/projects/${p.id}/duplicate`, { method: "POST" });
      await load();
      toast(`Copied. "${p.title} (copy)" is in To do.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`Delete "${p.title}" permanently? Its milestones, roadblocks, tasks and notes go with it.`)) return;
    if (!confirm("Last check — this can't be undone. Delete it?")) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      await load();
      toast("Deleted.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  const blockers = projects.reduce((n, p) => n + p.openRoadblocks, 0);

  return (
    <div id="shell">
      <TopBar onNew={newProject} onImport={() => setImporting(true)} />

      <div className="strip">
        {STATUS_COLUMNS.map((c) => (
          <div key={c.key} className={`stat ${c.dim ? "muted" : ""}`}>
            <div className="stat-n">{projects.filter((p) => p.status === c.key).length}</div>
            <div className="stat-l">{c.label}</div>
          </div>
        ))}
        <div className="stat alert">
          <div className="stat-n">{blockers}</div>
          <div className="stat-l">Roadblocks</div>
        </div>
      </div>

      <div className="board">
        {STATUS_COLUMNS.map((c) => {
          const list = projects.filter((p) => p.status === c.key);
          return (
            <div
              key={c.key}
              className={`col ${c.dim ? "dim" : ""} ${dragOver === c.key ? "drop" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(c.key); }}
              onDragLeave={() => setDragOver((v) => (v === c.key ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) moveProject(id, c.key);
              }}
            >
              <div className="col-head">
                <span className="col-name">{c.label}</span>
                <span className="col-count">{list.length}</span>
              </div>
              <div className="stack">
                {loading
                  ? <div className="skeleton" />
                  : list.length
                    ? list.map((p) => (
                        <Card
                          key={p.id}
                          p={p}
                          onOpen={() => openProject(p.id)}
                          onDuplicate={duplicate}
                          onDelete={remove}
                        />
                      ))
                    : <div className="col-empty">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>

      {importing && (
        <ImportDialog onClose={() => setImporting(false)} onDone={load} />
      )}

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => { setSelected(null); load(); }}
        onChange={(fresh) => {
          // The panel hands back the updated project, so nothing refetches.
          if (fresh) setSelected(fresh);
        }}
      />
    </div>
  );
}

export default function BoardPage() {
  return <ToastHost><BoardInner /></ToastHost>;
}
