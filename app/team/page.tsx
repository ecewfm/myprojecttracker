"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import type { Member } from "@/lib/types";

function Inner() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "" });

  const load = useCallback(async () => {
    try { setMembers(await api<Member[]>("/api/team")); }
    catch (e: any) { toast(e.message, "err"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ synced: number; deactivated: number }>("/api/team/sync", { method: "POST" });
      await load();
      toast(`${r.synced} people synced from Zoho.`);
    } catch (e: any) { toast(e.message, "err"); }
    setSyncing(false);
  }

  async function add() {
    if (!draft.name.trim() || !draft.email.trim()) { toast("Name and email are both needed.", "err"); return; }
    try {
      await api("/api/team", { method: "POST", body: draft });
      setDraft({ name: "", email: "" });
      await load();
      toast("Added.");
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function remove(id: string) {
    try {
      await api("/api/team", { method: "PATCH", body: { id, active: false } });
      await load();
      toast("Removed from the assignable list.");
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
            <b>Zoho is the source.</b> Names and emails come from ECE Time Tracker, and the
            email doubles as the Cliq handle for reminders. Syncing overwrites what's here.
            <button onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>
          </div>

          {members.map((m) => (
            <div key={m.id} className="person">
              <div>
                <div className="person-n">{m.name}</div>
                <div className="person-e">{m.email}</div>
              </div>
              <div className="person-acts">
                <button onClick={() => remove(m.id)}>Remove</button>
              </div>
            </div>
          ))}

          {members.length === 0 && (
            <div className="empty">
              Nobody here yet. Sync from Zoho, or add someone by hand below.
            </div>
          )}

          <div className="sect">
            <div className="sect-title">Add someone manually</div>
            <div className="sect-desc">For anyone not on the Zoho roster. The email must match their Cliq account.</div>
            <div className="inline-form">
              <input placeholder="Full name" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
              <input placeholder="name@ececonsultinggroup.com" value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn btn-solid" onClick={add}>Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
