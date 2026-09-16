"use client";

import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import ProjectPanel from "@/components/ProjectPanel";
import type { Project, Member } from "@/lib/types";

interface Item {
  id: string; projectId: string;
  type: "milestone" | "sub" | "task" | "roadblock";
  name: string; parent: string | null;
  assignees: string[]; due: string | null;
  done: boolean; hasNote: boolean; hasImages: boolean;
}
interface Proj {
  id: string; ref: string; title: string;
  owner: string | null; due: string | null;
  percent: number; priority: boolean; status: string;
}

const TYPE_LABEL = {
  milestone: "Milestone", sub: "Step", task: "Action", roadblock: "Roadblock",
} as const;

const dayGap = (d: string | null, today: string) =>
  d ? Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;

/** "3d over", "today", "in 5d" — easier to read than doing the sums yourself. */
function relative(gap: number | null) {
  if (gap === null) return "";
  return gap < 0 ? `${Math.abs(gap)}d over` : gap === 0 ? "today" : `in ${gap}d`;
}

function Inner() {
  const toast = useToast();
  const [projects, setProjects] = useState<Proj[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [today, setToday] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [fType, setFType] = useState("");
  const [fWho, setFWho] = useState("");
  const [fStatus, setFStatus] = useState("open");

  const [asking, setAsking] = useState<{ project: Proj; people: { name: string; count: number }[] } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, team] = await Promise.all([
        api<{ today: string; projects: Proj[]; items: Item[] }>("/api/items"),
        api<Member[]>("/api/team"),
      ]);
      setProjects(data.projects);
      setItems(data.items);
      setToday(data.today);
      setMembers(team);
    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const people = useMemo(
    () => [...new Set(items.flatMap((i) => i.assignees))].sort(),
    [items]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      const late = !i.done && i.due && i.due < today;
      if (fType && i.type !== fType) return false;
      if (fWho && !i.assignees.includes(fWho)) return false;
      if (fStatus === "open" && i.done) return false;
      if (fStatus === "late" && !late) return false;
      if (fStatus === "unassigned" && i.assignees.length) return false;
      if (needle && !i.name.toLowerCase().includes(needle)
          && !i.assignees.join(" ").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, q, fType, fWho, fStatus, today]);

  /**
   * Group what survives the filters. Projects with nothing left drop out —
   * a filtered view shouldn't be a page of empty headers.
   */
  const groups = useMemo(() => {
    const byProject = new Map<string, Item[]>();
    for (const i of visible) byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i]);

    return projects
      .filter((p) => byProject.has(p.id))
      .map((p) => {
        const list = byProject.get(p.id)!;
        return {
          p,
          list,
          open: list.filter((i) => !i.done).length,
          late: list.filter((i) => !i.done && i.due && i.due < today).length,
          blocked: list.filter((i) => i.type === "roadblock" && !i.done).length,
        };
      })
      // Worst first: most overdue, then most blocked. The top of the table
      // is where the trouble is.
      .sort((a, b) => b.late - a.late || b.blocked - a.blocked);
  }, [visible, projects, today]);

  async function openProject(id: string) {
    try { setSelected(await api<Project>(`/api/projects/${id}`)); }
    catch (e: any) { toast(e.message, "err"); }
  }

  async function ask(p: Proj) {
    try {
      const r = await api<{ people: { id: string; name: string; count: number }[] }>(
        `/api/projects/${p.id}/remind`
      );
      setAsking({ project: p, people: r.people });
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function send() {
    if (!asking) return;
    setSending(true);
    const p = asking.project;
    setAsking(null);
    try {
      const r = await api<{ sent: number; people: number }>(
        `/api/projects/${p.id}/remind`, { method: "POST" }
      );
      toast(`${r.sent} message${r.sent === 1 ? "" : "s"} sent for ${p.title}.`);
    } catch (e: any) { toast(e.message, "err"); }
    setSending(false);
  }

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totalLate = visible.filter((i) => !i.done && i.due && i.due < today).length;
  const totalNone = visible.filter((i) => !i.done && !i.assignees.length).length;

  return (
    <div id="shell">
      <TopBar />
      <div className="it-wrap">
        <div className="it-panel">
          <div className="it-head">
            <div>
              <h2>All items</h2>
              <p>
                Every project with what's open beneath it. Click a project to see its
                milestones, steps, actions and roadblocks.
              </p>
            </div>
            <div className="it-head-r">
              <button className="btn" onClick={() => setOpenIds(new Set(projects.map((p) => p.id)))}>
                Expand all
              </button>
              <button className="btn" onClick={() => setOpenIds(new Set())}>Collapse all</button>
            </div>
          </div>

          <div className="it-controls">
            <input
              className="it-search"
              placeholder="Search item or person…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">All types</option>
              <option value="milestone">Milestones</option>
              <option value="sub">Sub-milestones</option>
              <option value="task">Action items</option>
              <option value="roadblock">Roadblocks</option>
            </select>
            <select value={fWho} onChange={(e) => setFWho(e.target.value)}>
              <option value="">Anyone</option>
              {people.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="open">Open only</option>
              <option value="">Any status</option>
              <option value="late">Overdue only</option>
              <option value="unassigned">Nobody assigned</option>
            </select>
          </div>

          {loading && <div className="skeleton" style={{ height: 140, margin: "0 22px 22px" }} />}

          {!loading && (
            <div className="it-scroll">
              <table className="it-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 300 }}>Project / item</th>
                    <th style={{ width: 130 }}>Progress</th>
                    <th style={{ width: 190 }}>Assigned to</th>
                    <th style={{ width: 110 }}>Due</th>
                    <th className="it-num">Open</th>
                    <th className="it-num">Overdue</th>
                    <th className="it-num">Blocked</th>
                    <th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 && (
                    <tr><td colSpan={8} className="empty" style={{ padding: 36 }}>
                      Nothing matches those filters.
                    </td></tr>
                  )}

                  {groups.map(({ p, list, open, late, blocked }) => {
                    const isOpen = openIds.has(p.id);
                    const gap = dayGap(p.due, today);

                    return (
                      <Fragment key={p.id}>
                        <tr
                          className={`it-proj ${isOpen ? "open" : ""}`}
                          onClick={() => toggle(p.id)}
                        >
                          <td>
                            <div className="it-pname">
                              <span className="it-car">▸</span>
                              <div>
                                <div className="it-pt">
                                  {p.title}
                                  {p.priority && <span className="lab lab-priority">Priority</span>}
                                </div>
                                <div className="it-ps">{p.ref}{p.owner ? ` · ${p.owner}` : ""}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="it-prog">
                              <div className="it-ptrack">
                                <div
                                  className={`it-pfill ${blocked ? "blocked" : ""}`}
                                  style={{ width: `${p.percent}%` }}
                                />
                              </div>
                              <span className="it-pn">{p.percent}%</span>
                            </div>
                          </td>
                          <td className="it-who">{p.owner ?? <span className="it-none">Unassigned</span>}</td>
                          <td className={`it-due ${gap !== null && gap < 0 ? "late" : gap !== null && gap <= 7 ? "soon" : ""}`}>
                            {p.due ? <>{p.due}<div className="it-sub2">{relative(gap)}</div></> : "—"}
                          </td>
                          <td className="it-num"><span className={`it-cnt ${open ? "plain" : "zero"}`}>{open || "—"}</span></td>
                          <td className="it-num"><span className={`it-cnt ${late ? "red" : "zero"}`}>{late || "—"}</span></td>
                          <td className="it-num"><span className={`it-cnt ${blocked ? "red" : "zero"}`}>{blocked || "—"}</span></td>
                          <td>
                            <button
                              className="btn btn-sm"
                              disabled={sending}
                              onClick={(e) => { e.stopPropagation(); ask(p); }}
                            >
                              Send reminders
                            </button>
                          </td>
                        </tr>

                        {isOpen && list.map((i) => {
                          const g = dayGap(i.due, today);
                          const isLate = !i.done && i.due && i.due < today;
                          return (
                            <tr
                              key={i.id}
                              className={`it-item ${i.done ? "done" : ""}`}
                              onClick={() => openProject(p.id)}
                            >
                              <td className={`it-iname ${i.type === "sub" ? "sub" : ""}`}>
                                {i.name}
                                {i.parent && <span className="it-ipar">under {i.parent}</span>}
                              </td>
                              <td><span className={`it-t it-t-${i.type}`}>{TYPE_LABEL[i.type]}</span></td>
                              <td className="it-who">
                                {i.assignees.length
                                  ? i.assignees.join(", ")
                                  : <span className="it-none">Nobody</span>}
                              </td>
                              <td className={`it-due ${i.done ? "" : isLate ? "late" : g !== null && g <= 3 ? "soon" : ""}`}>
                                {i.due
                                  ? <>{i.due}{!i.done && <div className="it-sub2">{relative(g)}</div>}</>
                                  : <span className="it-none-q">—</span>}
                              </td>
                              <td className="it-num" colSpan={2}>
                                <span className={`it-st ${i.done ? "done" : isLate ? "late" : "open"}`}>
                                  {i.done ? "Done" : isLate ? "Overdue" : "Open"}
                                </span>
                              </td>
                              <td className="it-num">
                                <span className="it-mk">
                                  {i.hasNote ? "📝" : ""}{i.hasImages ? "🖼" : ""}
                                </span>
                              </td>
                              <td />
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="it-foot">
            <span>
              <b>{groups.length}</b> project{groups.length === 1 ? "" : "s"} · {visible.length} items
              {totalLate > 0 && <span style={{ color: "var(--red)" }}> · {totalLate} overdue</span>}
              {totalNone > 0 && <span style={{ color: "var(--red)" }}> · {totalNone} with nobody assigned</span>}
            </span>
            <span>Worst first — most overdue at the top</span>
          </div>
        </div>
      </div>

      {asking && (
        <div className="rm-scrim" onClick={(e) => { if (e.target === e.currentTarget) setAsking(null); }}>
          <div className="rm-modal">
            <h4>Send reminders now?</h4>
            <p>
              Everyone below gets one message listing their open items on
              <b> {asking.project.title}</b>. This ignores the schedule and goes immediately.
            </p>
            <div className="rm-who">
              {asking.people.length
                ? asking.people.map((w) => (
                    <div key={w.name}><b>{w.name}</b> — {w.count} item{w.count === 1 ? "" : "s"}</div>
                  ))
                : <div style={{ color: "var(--red)" }}>
                    Nobody on this project has anything open and assigned.
                  </div>}
            </div>
            <div className="rm-foot">
              <button className="btn" onClick={() => setAsking(null)}>Cancel</button>
              <button className="btn btn-solid" disabled={!asking.people.length} onClick={send}>
                {asking.people.length
                  ? `Send ${asking.people.length} message${asking.people.length === 1 ? "" : "s"}`
                  : "Nothing to send"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => setSelected(null)}
        onChange={(full?: Project) => { if (full) setSelected(full); else load(); }}
      />
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
