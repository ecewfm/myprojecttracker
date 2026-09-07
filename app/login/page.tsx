"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const { error } = await res.json();
      setError(error ?? "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-inner" onSubmit={signIn}>
        <div className="login-mark">ECE</div>
        <h1>Projects</h1>

        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" value={username} autoComplete="username"
            onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input id="p" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {error && <div className="login-error">{error}</div>}
        <div className="login-note">
          One account, held in the deployment environment. Nothing to reset here.
        </div>
      </form>
    </div>
  );
}
