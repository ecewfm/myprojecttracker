"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import ProjectPanel from "@/components/ProjectPanel";
import { STATUS_COLUMNS, type Project, type Member } from "@/lib/types";

function Card({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const open = p.roadblocks.filter((r) => r.status !== "resolved");
  const severe = open.some((r) => r.status === "open" || r.status === "escalated");
  const today = new Date().toISOString().slice(0, 10);
  const late = p.due_date && p.due_date < today && p.percent < 100;

  return (
    <button className={`card ${open.length ? "blocked" : ""}`} onClick={onOpen}>
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

      {open.length > 0 && (
        <div className={`flag ${severe ? "" : "amber"}`}>
          <span className="pip" />
          {open.length} roadblock{open.length > 1 ? "s" : ""}
        </div>
      )}

      <div className="prog">
        <div className="prog-track"><div className="prog-fill" style={{ width: `${p.percent}%` }} /></div>
        <span className="prog-n">{p.percent}%</span>
      </div>

      <div className="ticks">
        {p.milestones.map((m) => (
          <span key={m.id} className={`tick ${m.done ? "on" : m.note ? "note" : ""}`} />
        ))}
      </div>

      <div className="card-phase"><b>{p.phase ?? "No phase set"}</b></div>
    </button>
  );
}

function BoardInner() {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ps, ms] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<Member[]>("/api/team"),
      ]);
      setProjects(ps);
      setMembers(ms);
      setSelected((cur) => (cur ? ps.find((p) => p.id === cur.id) ?? null : null));
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

  const blockers = projects.reduce(
    (n, p) => n + p.roadblocks.filter((r) => r.status !== "resolved").length, 0
  );

  return (
    <div id="shell">
      <TopBar onNew={newProject} />

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
            <div key={c.key} className={`col ${c.dim ? "dim" : ""}`}>
              <div className="col-head">
                <span className="col-name">{c.label}</span>
                <span className="col-count">{list.length}</span>
              </div>
              <div className="stack">
                {loading
                  ? <div className="skeleton" />
                  : list.length
                    ? list.map((p) => <Card key={p.id} p={p} onOpen={() => setSelected(p)} />)
                    : <div className="col-empty">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => setSelected(null)}
        onChange={load}
      />
    </div>
  );
}

export default function BoardPage() {
  return <ToastHost><BoardInner /></ToastHost>;
}
