"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import ProjectPanel from "@/components/ProjectPanel";
import { STATUS_COLUMNS, type Project, type Member } from "@/lib/types";
import type { ProjectSummary } from "@/lib/data";
import { zoneToday } from "@/lib/tz";

const LIVE = ["todo", "pending", "dev", "testing"];

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;          // Monday-first
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
};
const fmtWeek = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const parse = (s: string) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd);
};
// Dates render in the app timezone; see lib/tz.ts
const iso = (d: Date) => d.toISOString().slice(0, 10);


/**
 * When a project starts. Nothing records this explicitly, so: the earliest
 * milestone due date if any milestone has one, otherwise the day the
 * project was created.
 */
function startOf(p: ProjectSummary): string {
  const dates = p.milestones.map((m) => m.due_date).filter(Boolean) as string[];
  if (dates.length) return dates.sort()[0];
  return p.created_at.slice(0, 10);
}

function Inner() {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [weeks, setWeeks] = useState(16);
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ps, ms] = await Promise.all([
        api<ProjectSummary[]>("/api/projects"),
        api<Member[]>("/api/team"),
      ]);
      setProjects(ps);
      setMembers(ms);

    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  /** The full project is only fetched when a row is opened. */
  async function openProject(id: string) {
    try { setSelected(await api<Project>(`/api/projects/${id}`)); }
    catch (e: any) { toast(e.message, "err"); }
  }

  const today = new Date();
  const todayIso = zoneToday();

  // The window opens four weeks before this week, so recent history is visible.
  const first = useMemo(() => addDays(startOfWeek(today), -28), [today.getDate()]);
  const last = useMemo(() => addDays(first, weeks * 7), [first, weeks]);
  const span = last.getTime() - first.getTime();

  const cols = useMemo(
    () => Array.from({ length: weeks }, (_, i) => addDays(first, i * 7)),
    [first, weeks]
  );

  const pct = (dateStr: string) =>
    Math.max(0, Math.min(100, ((parse(dateStr).getTime() - first.getTime()) / span) * 100));

  const rows = useMemo(() => {
    const list = showDone ? projects : projects.filter((p) => LIVE.includes(p.status));
    return list
      .map((p) => {
        const start = startOf(p);
        const due = p.due_date ?? iso(addDays(parse(start), 60));
        return {
          p,
          start,
          due,
          hasDue: !!p.due_date,
          late: !!p.due_date && p.due_date < todayIso && p.percent < 100,
          milestones: p.milestones.filter((m) => m.due_date),
          roadblocks: p.openRoadblocks,
          // Delayed counts overdue action items and overdue milestones.
          delayed: p.overdueTasks + p.overdueMilestones,
        };
      })
      .sort((a, b) => a.due.localeCompare(b.due));
  }, [projects, showDone, todayIso, first, span]);

  const todayLeft = ((today.getTime() - first.getTime()) / span) * 100;
  const nowWeek = startOfWeek(today).getTime();

  return (
    <div id="shell">
      <TopBar />
      <div className="tl-wrap">
        <div className="tl-panel">
          <div className="tl-head">
            <div>
              <h2>Timeline</h2>
              <p>
                Every project against the calendar. Diamonds are milestones, the orange line is today.
              </p>
            </div>
            <div className="tl-controls">
              <button
                className={`tl-btn ${showDone ? "on" : ""}`}
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone ? "All projects" : "Active only"}
              </button>
              {[12, 16, 26].map((w) => (
                <button
                  key={w}
                  className={`tl-btn ${weeks === w ? "on" : ""}`}
                  onClick={() => setWeeks(w)}
                >{w} weeks</button>
              ))}
            </div>
          </div>

          {loading && <div className="skeleton" style={{ height: 180, margin: "0 22px 22px" }} />}

          {!loading && rows.length === 0 && (
            <div className="empty" style={{ padding: "0 22px 22px" }}>
              Nothing to show. Projects appear here once they're in an active column.
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="tl-scroll">
              <table className="tl-table">
                <thead>
                  <tr>
                    <th className="tl-lbl">Project</th>
                    {cols.map((w) => (
                      <th
                        key={w.toISOString()}
                        className={`tl-wk ${w.getTime() === nowWeek ? "now" : ""}`}
                      >{fmtWeek(w)}</th>
                    ))}
                    <th className="tl-rt">Road&shy;blocks</th>
                    <th className="tl-rt">Delayed</th>
                    <th className="tl-rt tl-owner-h">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const l = pct(r.start);
                    const w = Math.max(1.5, pct(r.due) - l);
                    return (
                      <tr key={r.p.id} onClick={() => openProject(r.p.id)}>
                        <td className="tl-name">
                          <div className="tl-t">
                            {r.p.title}
                            {r.p.priority && <span className="lab lab-priority">Priority</span>}
                          </div>
                          <div className="tl-sub">
                            {r.p.ref} · {STATUS_COLUMNS.find((c) => c.key === r.p.status)?.label}
                            {r.hasDue ? ` · due ${r.due}` : " · no target date"}
                          </div>
                        </td>

                        <td className="tl-track" colSpan={weeks}>
                          <div className="tl-grid">
                            {cols.map((c) => <span key={c.toISOString()} />)}
                          </div>
                          {todayLeft >= 0 && todayLeft <= 100 && (
                            <div className="tl-today" style={{ left: `${todayLeft}%` }} />
                          )}
                          <div className="tl-bararea">
                            <div
                              className={`tl-bar ${r.late ? "late" : ""} ${r.hasDue ? "" : "nodue"}`}
                              style={{ left: `${l}%`, width: `${w}%` }}
                            >
                              <div
                                className="tl-remain"
                                style={{ left: `${r.p.percent}%`, width: `${100 - r.p.percent}%` }}
                              />
                            </div>
                            <span className="tl-pct" style={{ left: `calc(${l + w}% + 8px)` }}>
                              {r.p.percent}%
                            </span>
                            {r.milestones.map((m) => {
                              const overdue = !m.done && m.due_date! < todayIso;
                              return (
                                <span
                                  key={m.id}
                                  className={`tl-ms ${m.done ? "done" : ""} ${overdue ? "late" : ""} ${m.sub ? "sub" : ""}`}
                                  style={{ left: `${pct(m.due_date!)}%` }}
                                  title={`${m.due_date}${m.done ? " · done" : overdue ? " · overdue" : ""}`}
                                />
                              );
                            })}
                          </div>
                        </td>

                        <td className="tl-rt">
                          <span className={`tl-cnt ${r.roadblocks ? "red" : "zero"}`}>
                            {r.roadblocks || "—"}
                          </span>
                        </td>
                        <td className="tl-rt">
                          <span className={`tl-cnt ${r.delayed ? "amber" : "zero"}`}>
                            {r.delayed || "—"}
                          </span>
                        </td>
                        <td className="tl-owner">
                          {r.p.owner
                            ? r.p.owner.name
                            : <span className="tl-none">Unassigned</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="tl-legend">
            <div><span className="tl-key bar" /> On track</div>
            <div><span className="tl-key bar late" /> Past target date</div>
            <div><span className="tl-key done" /> Milestone done</div>
            <div><span className="tl-key" /> Milestone open</div>
            <div><span className="tl-key sub" /> Sub-milestone</div>
            <div><span className="tl-key line" /> Today</div>
          </div>
        </div>
      </div>

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => { setSelected(null); load(); }}
        onChange={(fresh) => { if (fresh) setSelected(fresh); }}
      />
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
