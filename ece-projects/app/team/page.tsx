"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import type { Member } from "@/lib/types";

interface RosterHit {
  name: string; email: string; zoho_id: string;
  job_position: string | null; account: string | null; site: string | null;
  already_added: boolean;
}

function Inner() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState("");

  // roster search
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterQ, setRosterQ] = useState("");
  const [rosterHits, setRosterHits] = useState<RosterHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await api<Member[]>("/api/team")); }
    catch (e: any) { toast(e.message, "err"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // distinct job positions for the filter dropdown
  const positions = useMemo(() => {
    const s = new Set<string>();
    members.forEach((m) => m.job_position && s.add(m.job_position));
    return Array.from(s).sort();
  }, [members]);

  const shown = useMemo(() => {
    if (!posFilter) return members;
    return members.filter((m) => m.job_position === posFilter);
  }, [members, posFilter]);

  const allShownSelected = shown.length > 0 && shown.every((m) => selected.has(m.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allShownSelected) {
        const next = new Set(prev);
        shown.forEach((m) => next.delete(m.id));
        return next;
      }
      return new Set([...prev, ...shown.map((m) => m.id)]);
    });
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ synced: number; mapping_warning: string | null }>(
        "/api/team/sync", { method: "POST" }
      );
      await load();
      toast(
        r.mapping_warning
          ? `${r.synced} synced, but some detail columns were empty — check the field mapping.`
          : `${r.synced} people synced from Zoho.`,
        r.mapping_warning ? "err" : "ok"
      );
    } catch (e: any) { toast(e.message, "err"); }
    setSyncing(false);
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} ${ids.length === 1 ? "person" : "people"} from the team list? This doesn't touch Zoho — a re-sync brings them back.`)) return;
    try {
      await api("/api/team", { method: "DELETE", body: { ids } });
      setSelected(new Set());
      await load();
      toast(`${ids.length} removed.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function deleteOne(id: string, name: string) {
    if (!confirm(`Remove ${name} from the team list?`)) return;
    try {
      await api("/api/team", { method: "DELETE", body: { ids: id } });
      await load();
      toast("Removed.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  // ── roster search ──
  async function runRosterSearch(q: string) {
    setSearching(true);
    try {
      setRosterHits(await api<RosterHit[]>(`/api/team/roster?q=${encodeURIComponent(q)}`));
    } catch (e: any) { toast(e.message, "err"); }
    setSearching(false);
  }

  // debounce roster search
  useEffect(() => {
    if (!rosterOpen) return;
    const t = setTimeout(() => runRosterSearch(rosterQ), 350);
    return () => clearTimeout(t);
  }, [rosterQ, rosterOpen]); // eslint-disable-line

  async function addFromRoster(p: RosterHit) {
    try {
      await api("/api/team", {
        method: "POST",
        body: {
          name: p.name, email: p.email, zoho_id: p.zoho_id,
          job_position: p.job_position, account: p.account, site: p.site,
        },
      });
      await load();
      setRosterHits((hits) =>
        hits.map((h) => (h.email === p.email ? { ...h, already_added: true } : h))
      );
      toast(`${p.name.split(" ")[0]} added.`);
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div id="shell">
      <TopBar />
      <div className="page">
        <div className="page-card">
          <h2>Team</h2>
          <div className="page-sub">Who you can assign work to.</div>

          <div className="notice">
            <b>Zoho is the source.</b> Names, roles, and accounts come from ECE Time Tracker,
            and the email doubles as the Cliq handle for reminders. A full sync overwrites
            this list.
            <button onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync all"}</button>
          </div>

          {/* search + add from roster */}
          <div className="sect" style={{ paddingTop: 0, borderTop: "none" }}>
            <button className="btn btn-solid" onClick={() => { setRosterOpen((o) => !o); if (!rosterOpen) runRosterSearch(""); }}>
              {rosterOpen ? "Close roster search" : "Search Zoho roster to add"}
            </button>

            {rosterOpen && (
              <div className="rb-add on" style={{ marginTop: 12, display: "block" }}>
                <input
                  autoFocus
                  placeholder="Search by name, role, account, or email…"
                  value={rosterQ}
                  onChange={(e) => setRosterQ(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
                {searching && <div className="empty">Searching…</div>}
                {!searching && rosterHits.length === 0 && (
                  <div className="empty">No matches in the Zoho roster.</div>
                )}
                {rosterHits.map((p) => (
                  <div key={p.email} className="person" style={{ marginBottom: 6 }}>
                    <div>
                      <div className="person-n">{p.name}</div>
                      <div className="person-e">
                        {[p.job_position, p.account].filter(Boolean).join(" · ") || "—"}
                        <br />{p.email}
                      </div>
                    </div>
                    <div className="person-acts">
                      {p.already_added
                        ? <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Already added</span>
                        : <button onClick={() => addFromRoster(p)}>Add</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* filter + bulk actions bar */}
          {members.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, cursor: "pointer" }}>
                <span
                  className={`ms-box ${allShownSelected ? "on" : ""}`}
                  onClick={toggleAll}
                >{allShownSelected ? "✓" : ""}</span>
                Select all
              </label>

              <select
                value={posFilter}
                onChange={(e) => setPosFilter(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13, minWidth: 200 }}
              >
                <option value="">All job positions ({members.length})</option>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {p} ({members.filter((m) => m.job_position === p).length})
                  </option>
                ))}
              </select>

              {selected.size > 0 && (
                <button
                  className="btn"
                  onClick={deleteSelected}
                  style={{ color: "var(--red)", borderColor: "rgba(184,69,58,.4)", marginLeft: "auto" }}
                >
                  Delete {selected.size} selected
                </button>
              )}
            </div>
          )}

          {/* roster list */}
          {shown.map((m) => (
            <div key={m.id} className="person">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <span
                  className={`ms-box ${selected.has(m.id) ? "on" : ""}`}
                  role="checkbox" aria-checked={selected.has(m.id)}
                  onClick={() => toggleOne(m.id)}
                  style={{ flexShrink: 0 }}
                >{selected.has(m.id) ? "✓" : ""}</span>
                <div>
                  <div className="person-n">{m.name}</div>
                  <div className="person-e">
                    {[m.job_position, m.account].filter(Boolean).join(" · ") || "No role on file"}
                    {m.site ? ` · ${m.site}` : ""}
                    <br />{m.email}
                  </div>
                </div>
              </div>
              <div className="person-acts">
                <button onClick={() => deleteOne(m.id, m.name)}>Delete</button>
              </div>
            </div>
          ))}

          {members.length === 0 && (
            <div className="empty">
              Nobody here yet. Sync all from Zoho, search the roster to add specific people,
              or add someone by hand below.
            </div>
          )}

          {shown.length === 0 && members.length > 0 && (
            <div className="empty">No one matches that filter.</div>
          )}

          {/* manual add */}
          <div className="sect">
            <div className="sect-title">Add someone manually</div>
            <div className="sect-desc">For anyone not on the Zoho roster. The email must match their Cliq account.</div>
            <ManualAdd onAdded={load} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualAdd({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const [d, setD] = useState({ name: "", email: "", job_position: "", account: "" });

  async function add() {
    if (!d.name.trim() || !d.email.trim()) { toast("Name and email are both needed.", "err"); return; }
    try {
      await api("/api/team", { method: "POST", body: d });
      setD({ name: "", email: "", job_position: "", account: "" });
      onAdded();
      toast("Added.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div>
      <div className="fld-2" style={{ marginBottom: 10 }}>
        <input placeholder="Full name" value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          style={{ padding: "9px 12px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13 }} />
        <input placeholder="name@ececontactcenters.com" value={d.email}
          onChange={(e) => setD({ ...d, email: e.target.value })}
          style={{ padding: "9px 12px", borderRadius: 9, border: "1px solid var(--g-brd-2)", background: "rgba(255,255,255,.5)", fontSize: 13 }} />
      </div>
      <div className="inline-form">
        <input placeholder="Job position (optional)" value={d.job_position}
          onChange={(e) => setD({ ...d, job_position: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
        <input placeholder="Account (optional)" value={d.account}
          onChange={(e) => setD({ ...d, account: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
        <button className="btn btn-solid" onClick={add}>Add</button>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
