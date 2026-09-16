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
  const today = zoneToday();
  const late = p.due_date && p.due_date < today && p.percent < 100;
  const people = [p.owner, ...p.members].filter(Boolean) as { name: string }[];

  return (
    <button
      className={`card ${p.openRoadblocks ? "blocked" : ""}`}
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <span className="card-acts">
        <span
          className="icon-act" role="button" tabIndex={0} title="Duplicate this project"
          onClick={(e) => { e.stopPropagation(); onDuplicate(p); }}
        >⧉</span>
        <span
          className="icon-act del" role="button" tabIndex={0} title="Delete this project"
          onClick={(e) => { e.stopPropagation(); onDelete(p); }}
        >🗑</span>
      </span>

      <div className="card-top">
        <span className="card-name">{p.title}</span>
        <span className="card-ref">{p.ref}</span>
      </div>
      <div className="card-who">
        {people.map((m) => m.name).join(", ") || "Unassigned"}
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

      {p.openRoadblocks > 0 && (
        <div className="flag">
          <span className="pip" />
          {p.openRoadblocks} roadblock{p.openRoadblocks > 1 ? "s" : ""}
        </div>
      )}

      <div className="prog">
        <div className="prog-track"><div className="prog-fill" style={{ width: `${p.percent}%` }} /></div>
        <span className="prog-n">{p.percent}%</span>
      </div>

      <div className="ticks">
        {p.milestones.map((m) => (
          <span key={m.id} className={`tick ${m.done ? "on" : m.hasNote ? "note" : ""}`} />
        ))}
      </div>
    </button>
  );
}

function BoardInner() {
  const toast = useToast();
  const [cards, setCards] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  /** The board only ever loads summaries — a fraction of the full payload. */
  const load = useCallback(async () => {
    try {
      const [ps, ms] = await Promise.all([
        api<ProjectSummary[]>("/api/projects/summary"),
        api<Member[]>("/api/team"),
      ]);
      setCards(ps);
      setMembers(ms);
    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  /** The full project is fetched once, when its panel opens. */
  async function open(id: string) {
    try {
      setSelected(await api<Project>(`/api/projects/${id}`));
    } catch (e: any) { toast(e.message, "err"); }
  }

  /**
   * The panel is optimistic — it patches its own state and hands the updated
   * project back here. We derive just the fields a card shows, so ticking a
   * checkbox never refetches the board. Called with no argument (after a
   * create or delete) it reloads properly.
   */
  const onPanelChange = useCallback((full?: Project) => {
    if (!full) { load(); return; }

    const top = full.milestones;
    setCards((prev) => prev.map((c) => c.id === full.id ? {
      ...c,
      title: full.title,
      status: full.status,
      due_date: full.due_date,
      priority: full.priority,
      shared: full.shared,
      labels: full.labels,
      owner: full.owner ? { id: full.owner.id, name: full.owner.name } : null,
      members: full.members.map((m) => ({ id: m.id, name: m.name })),
      percent: top.length
        ? Math.round((top.filter((m) => m.done).length / top.length) * 100)
        : 0,
      openRoadblocks: full.roadblocks.filter((r) => r.status !== "resolved").length,
      milestones: top.map((m) => ({
        id: m.id, done: m.done, due_date: m.due_date, hasNote: !!m.note, sub: false,
      })),
    } : c));
  }, [load]);

  async function moveProject(id: string, status: string) {
    const proj = cards.find((x) => x.id === id);
    if (!proj || proj.status === status) return;

    setCards((prev) =>
      prev.map((x) => (x.id === id ? { ...x, status: status as ProjectStatus } : x))
    );
    try {
      await api(`/api/projects/${id}`, { method: "PATCH", body: { status } });
    } catch (e: any) {
      toast(e.message, "err");
      load();
    }
  }

  async function newProject() {
    const title = prompt("Project name");
    if (!title?.trim()) return;
    try {
      await api("/api/projects", { method: "POST", body: { title: title.trim() } });
      await load();
      toast("Project created with the standard ten milestones.");
    } catch (e: any) { toast(e.message, "err"); }
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
      setCards((prev) => prev.filter((c) => c.id !== p.id));
      toast("Deleted.");
    } catch (e: any) { toast(e.message, "err"); load(); }
  }

  const blockers = cards.reduce((n, p) => n + p.openRoadblocks, 0);

  return (
    <div id="shell">
      <TopBar onNew={newProject} onImport={() => setImporting(true)} />

      <div className="strip">
        {STATUS_COLUMNS.map((c) => (
          <div key={c.key} className={`stat ${c.dim ? "muted" : ""}`}>
            <div className="stat-n">{cards.filter((p) => p.status === c.key).length}</div>
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
          const list = cards.filter((p) => p.status === c.key);
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
                          onOpen={() => open(p.id)}
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
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); load(); }}
        />
      )}

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => setSelected(null)}
        onChange={onPanelChange}
      />
    </div>
  );
}

export default function BoardPage() {
  return <ToastHost><BoardInner /></ToastHost>;
}
