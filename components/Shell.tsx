"use client";

import { useState, useCallback, createContext, useContext } from "react";
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
