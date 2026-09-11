"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import { ROADBLOCK_STATUS, type RoadblockStatus } from "@/lib/types";

interface Row {
  id: string; title: string; detail: string; status: RoadblockStatus;
  raised_at: string; target_date: string | null;
  roadblock_owners?: { team_members: { id: string; name: string } | null }[];
  projects: { id: string; ref: string; title: string };
}

function Inner() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setRows(await api<Row[]>("/api/roadblocks")); }
    catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function move(id: string, status: RoadblockStatus) {
    try {
      await api(`/api/roadblocks/${id}`, { method: "PATCH", body: { status } });
      await load();
      toast(status === "resolved" ? "Resolved. Reminders for it stop here." : `Set to ${ROADBLOCK_STATUS[status].label.toLowerCase()}.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  const days = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

  return (
    <div id="shell">
      <TopBar />
      <div className="page">
        <div className="page-card">
          <h2>Roadblocks</h2>
          <div className="page-sub">Everything currently blocked, oldest problems worth looking at first.</div>

          {loading && <div className="skeleton" style={{ height: 90 }} />}

          {!loading && rows.length === 0 && (
            <div className="empty">Nothing is blocked right now. Log a roadblock from inside a project when something stalls.</div>
          )}

          {rows.map((r) => (
            <div key={r.id} className="rb" data-s={r.status}>
              <div className="rb-top">
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 4, fontWeight: 500 }}>
                    {r.projects.ref} · {r.projects.title}
                  </div>
                  <span className="rb-title">{r.title}</span>
                </div>
                <select
                  className="stat-btn"
                  value={r.status}
                  onChange={(e) => move(r.id, e.target.value as RoadblockStatus)}
                  aria-label="Roadblock status"
                >
                  {(Object.keys(ROADBLOCK_STATUS) as RoadblockStatus[]).map((k) => (
                    <option key={k} value={k}>{ROADBLOCK_STATUS[k].label}</option>
                  ))}
                </select>
              </div>
              {r.detail && <div className="rb-desc">{r.detail}</div>}
              <div className="rb-foot">
                <span>{(r.roadblock_owners ?? []).map((o) => o.team_members?.name).filter(Boolean).join(", ") || "Unassigned"}</span>
                <span className="sep">·</span>
                <span>Open {days(r.raised_at)} day{days(r.raised_at) === 1 ? "" : "s"}</span>
                {r.target_date && (<><span className="sep">·</span><span>Target {r.target_date}</span></>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
