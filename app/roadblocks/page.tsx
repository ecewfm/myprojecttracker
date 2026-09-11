"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import ProjectPanel, { RoadblockCard } from "@/components/ProjectPanel";
import {
  ROADBLOCK_STATUS,
  type Project, type Member, type Roadblock, type RoadblockStatus,
} from "@/lib/types";

interface Row {
  id: string; title: string; detail: string; status: RoadblockStatus;
  raised_at: string; target_date: string | null; note: string;
  roadblock_owners?: { team_members: Member | null }[];
  projects: { id: string; ref: string; title: string };
}

function Inner() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [rb, ms] = await Promise.all([
        api<Row[]>("/api/roadblocks"),
        api<Member[]>("/api/team"),
      ]);
      setRows(rb);
      setMembers(ms);
    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  /** Open the project over this list, so you can carry on down it afterwards. */
  async function openProject(id: string) {
    try { setSelected(await api<Project>(`/api/projects/${id}`)); }
    catch (e: any) { toast(e.message, "err"); }
  }

  async function setStatus(id: string, status: RoadblockStatus) {
    // Resolved drops off this list, so reload rather than patching in place.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await api(`/api/roadblocks/${id}`, { method: "PATCH", body: { status } });
      toast(status === "resolved"
        ? "Resolved. Everyone waiting has been told."
        : `Set to ${ROADBLOCK_STATUS[status].label.toLowerCase()}.`);
      if (status === "resolved") await load();
    } catch (e: any) { toast(e.message, "err"); await load(); }
  }

  async function update(id: string, changes: Record<string, unknown>) {
    const picked = Array.isArray(changes.owner_ids)
      ? members.filter((m) => (changes.owner_ids as string[]).includes(m.id))
      : null;

    setRows((prev) => prev.map((r) => r.id === id ? {
      ...r,
      ...(changes.title !== undefined ? { title: changes.title as string } : {}),
      ...(changes.detail !== undefined ? { detail: changes.detail as string } : {}),
      ...(changes.note !== undefined ? { note: changes.note as string } : {}),
      ...(changes.target_date !== undefined
        ? { target_date: changes.target_date as string | null } : {}),
      ...(picked
        ? { roadblock_owners: picked.map((m) => ({ team_members: m })) } : {}),
    } : r));

    try {
      await api(`/api/roadblocks/${id}`, { method: "PATCH", body: changes });
      if (picked) {
        toast(picked.length
          ? `Assigned to ${picked.length === 1 ? picked[0].name.split(" ")[0] : `${picked.length} people`}. They've been messaged.`
          : "Owners cleared.");
      }
    } catch (e: any) { toast(e.message, "err"); await load(); }
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Delete the roadblock "${title}"?`)) return;
    try {
      await api(`/api/roadblocks/${id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast("Deleted.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  /** The shared card expects a Roadblock; the list carries the join shape. */
  const toRoadblock = (r: Row): Roadblock => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    note: r.note ?? "",
    owners: (r.roadblock_owners ?? []).map((o) => o.team_members).filter(Boolean) as Member[],
    raised_at: r.raised_at,
    target_date: r.target_date,
  });

  const unassigned = rows.filter(
    (r) => !(r.roadblock_owners ?? []).some((o) => o.team_members)
  ).length;

  return (
    <div id="shell">
      <TopBar />
      <div className="page" style={{ maxWidth: 820 }}>
        <div className="page-card">
          <h2>Roadblocks</h2>
          <div className="page-sub">
            Everything currently blocked, oldest problems worth looking at first.
            {unassigned > 0 && (
              <span style={{ color: "var(--red)", fontWeight: 500 }}>
                {" "}{unassigned} {unassigned === 1 ? "has" : "have"} nobody assigned,
                so nobody is being reminded about {unassigned === 1 ? "it" : "them"}.
              </span>
            )}
          </div>

          {loading && <div className="skeleton" style={{ height: 90 }} />}

          {!loading && rows.length === 0 && (
            <div className="empty">
              Nothing is blocked right now. Log a roadblock from inside a project when something stalls.
            </div>
          )}

          {rows.map((r) => (
            <div key={r.id} className="rb-wrap">
              <button
                className="rb-project"
                onClick={() => openProject(r.projects.id)}
                title="Open this project"
              >
                {r.projects.ref} · {r.projects.title}
              </button>

              <RoadblockCard
                r={toRoadblock(r)}
                members={members}
                busyStatus={(s) => setStatus(r.id, s)}
                onSave={(changes) => update(r.id, changes)}
                onDelete={() => remove(r.id, r.title)}
              />
            </div>
          ))}
        </div>
      </div>

      <ProjectPanel
        project={selected}
        members={members}
        onClose={() => setSelected(null)}
        onChange={(full?: Project) => {
          if (full) setSelected(full);
          // A roadblock may have changed inside the panel; refresh the list.
          load();
        }}
      />
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
