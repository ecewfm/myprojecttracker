"use client";

import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

/* ── toast ───────────────────────────────── */
type ToastFn = (message: string, kind?: "ok" | "err") => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);

  const show = useCallback<ToastFn>((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        className={`toast ${toast ? "on" : ""} ${toast?.kind === "err" ? "err" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast?.msg}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── api helper ──────────────────────────── */
export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/* ── nav ─────────────────────────────────── */
const NAV = [
  { href: "/", label: "Board" },
  { href: "/timeline", label: "Timeline" },
  { href: "/roadblocks", label: "Roadblocks" },
  { href: "/settings", label: "Settings" },
  { href: "/team", label: "Team" },
];

export function TopBar({ onNew }: { onNew?: () => void }) {
  const path = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="bar">
      <div className="bar-left">
        <div className="mark">ECE</div>
        <nav className="tabs">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`tab ${path === n.href ? "on" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="bar-right">
        <Notifications />
        {onNew && (
          <button className="btn btn-solid" onClick={onNew}>
            New project
          </button>
        )}
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

/* ── notifications ───────────────────────── */
interface Notif {
  id: string; kind: string; subject: string; note: string;
  ai_summary: string | null; seen: boolean; created_at: string;
  member: string; project: string;
}

const KIND_TEXT: Record<string, string> = {
  task_closed: "closed",
  milestone_closed: "completed",
  roadblock_added: "raised a roadblock",
  note_added: "left a note on",
};

export function Notifications() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ unseen: number; items: Notif[] }>("/api/notifications");
      setUnseen(r.unseen);
      setItems(r.items);
    } catch { /* the board still works without it */ }
  }, []);

  useEffect(() => {
    load();
    // Poll so updates from share links appear without a refresh.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unseen > 0) {
      await api("/api/notifications", { method: "PATCH", body: {} });
      setUnseen(0);
      setItems((prev) => prev.map((i) => ({ ...i, seen: true })));
    }
  }

  return (
    <div className="bell" ref={ref} style={{ position: "relative" }}>
      <button className="btn" onClick={toggle} aria-label="Updates from your team">
        Updates
        {unseen > 0 && <span className="bell-dot">{unseen > 9 ? "9+" : unseen}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          {items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: "var(--ink-3)" }}>
              Nothing yet. Updates people submit through their project links land here.
            </div>
          )}
          {items.map((n) => (
            <div key={n.id} className={`notif-item ${n.seen ? "" : "unseen"}`}>
              <div className="notif-who">{n.member}</div>
              <div className="notif-what">
                {KIND_TEXT[n.kind] ?? "updated"} <b>{n.subject}</b>
                {n.project ? ` — ${n.project}` : ""}
              </div>
              {n.note && <div className="notif-what" style={{ fontStyle: "italic" }}>&ldquo;{n.note}&rdquo;</div>}
              {n.ai_summary && <div className="notif-ai">{n.ai_summary}</div>}
              <div className="notif-when">
                {new Date(n.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
