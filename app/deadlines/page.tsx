"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import { formatDateInZone } from "@/lib/tz";

interface Item {
  key: string;
  kind: "milestone" | "task" | "roadblock";
  id: string;
  name: string;
  due_date: string | null;
  days_left: number | null;
  project: { id: string; ref: string; title: string };
  assignees: { id: string; name: string; email: string }[];
  last_nudge_at: string | null;
}

const KIND_LABEL = { milestone: "Milestone", task: "Action item", roadblock: "Roadblock" };

function whenLabel(days: number | null) {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `In ${days} days`;
}

function Inner() {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (d?: number) => {
    try {
      const r = await api<{ days: number; items: Item[] }>(
        `/api/deadlines${d ? `?days=${d}` : ""}`
      );
      setItems(r.items);
      setDays(r.days);
      setPicked(new Set());
    } catch (e: any) { toast(e.message, "err"); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const overdue = useMemo(() => items.filter((i) => (i.days_left ?? 0) < 0), [items]);
  const soon = useMemo(() => items.filter((i) => (i.days_left ?? 0) >= 0), [items]);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleGroup(group: Item[]) {
    const all = group.every((i) => picked.has(i.key));
    setPicked((prev) => {
      const next = new Set(prev);
      group.forEach((i) => all ? next.delete(i.key) : next.add(i.key));
      return next;
    });
  }

  async function resend() {
    if (!picked.size) return;
    setSending(true);
    try {
      const r = await api<{ sent: number; problems: string[] }>("/api/deadlines", {
        method: "POST", body: { keys: [...picked] },
      });
      toast(
        r.problems.length
          ? `${r.sent} sent, ${r.problems.length} failed — check Recent activity.`
          : `${r.sent} reminder${r.sent === 1 ? "" : "s"} sent.`,
        r.problems.length ? "err" : "ok"
      );
      await load(days ?? undefined);
    } catch (e: any) { toast(e.message, "err"); }
    setSending(false);
  }

  const group = (title: string, list: Item[], tone: "red" | "amber") => {
    if (!list.length) return null;
    const allPicked = list.every((i) => picked.has(i.key));
    return (
      <div className="dl-group">
        <div className="dl-group-head">
          <label className="dl-check-lbl">
            <span className={`ms-box ${allPicked ? "on" : ""}`} onClick={() => toggleGroup(list)}>
              {allPicked ? "✓" : ""}
            </span>
            <span className={`dl-group-title ${tone}`}>{title}</span>
            <span className="dl-group-n">{list.length}</span>
          </label>
        </div>

        {list.map((i) => (
          <div key={i.key} className={`dl-row ${picked.has(i.key) ? "on" : ""}`}>
            <span
              className={`ms-box ${picked.has(i.key) ? "on" : ""}`}
              role="checkbox" aria-checked={picked.has(i.key)} tabIndex={0}
              onClick={() => toggle(i.key)}
              onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); toggle(i.key); } }}
            >{picked.has(i.key) ? "✓" : ""}</span>

            <div className="dl-main">
              <div className="dl-name">{i.name}</div>
              <div className="dl-meta">
                <span className="dl-kind">{KIND_LABEL[i.kind]}</span>
                {i.project.title}
                {i.assignees.length
                  ? ` · ${i.assignees.map((a) => a.name).join(", ")}`
                  : " · nobody assigned"}
              </div>
            </div>

            <div className="dl-when">
              <div className={`dl-days ${tone}`}>{whenLabel(i.days_left)}</div>
              <div className="dl-date">{i.due_date}</div>
            </div>

            <div className="dl-nudge">
              {i.last_nudge_at
                ? `Last nudged ${formatDateInZone(i.last_nudge_at)}`
                : "Never nudged"}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div id="shell">
      <TopBar />
      <div className="page" style={{ maxWidth: 940 }}>
        <div className="page-card">
          <div className="dl-head">
            <div>
              <h2>Nearing deadlines</h2>
              <div className="page-sub" style={{ marginBottom: 0 }}>
                Anything overdue or due within {days ?? "…"} days. Pick items and send a reminder now.
              </div>
            </div>
            <div className="tl-controls">
              {[3, 5, 7, 14].map((d) => (
                <button
                  key={d}
                  className={`tl-btn ${days === d ? "on" : ""}`}
                  onClick={() => { setLoading(true); load(d); }}
                >{d} days</button>
              ))}
            </div>
          </div>

          {loading && <div className="skeleton" style={{ height: 140, marginTop: 20 }} />}

          {!loading && items.length === 0 && (
            <div className="empty" style={{ marginTop: 20 }}>
              Nothing due in the next {days} days, and nothing overdue. Good place to be.
            </div>
          )}

          {!loading && items.length > 0 && (
            <>
              <div className="dl-bar">
                <span className="dl-count">
                  {picked.size ? `${picked.size} selected` : "Select items to remind"}
                </span>
                <button
                  className="btn btn-solid"
                  disabled={!picked.size || sending}
                  onClick={resend}
                >
                  {sending ? "Sending…" : `Send reminder${picked.size === 1 ? "" : "s"}`}
                </button>
              </div>

              {group("Overdue", overdue, "red")}
              {group("Coming up", soon, "amber")}

              <div className="dl-note">
                Sending here ignores the normal cadence — it goes out straight away,
                to every person assigned. The automatic reminders then resume from now.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
