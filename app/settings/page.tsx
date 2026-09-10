"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar, ToastHost, api, useToast } from "@/components/Shell";
import { formatInZone, zoneLabel } from "@/lib/tz";

interface Settings {
  reminder_base: string;
  escalate_within_days: number;
  reminder_escalated: string;
  mention_in_group: boolean;
  copy_manager: boolean;
  notify_on_roadblock: boolean;
  nudge_open_roadblocks: boolean;
  digest_day: number;
  digest_hour: number;
  digest_recipients: string[];
  digest_sections: Record<string, boolean>;
  custom_labels: { name: string; color: string }[];
  nearing_days: number;
  dm_start_hour: number;
  dm_end_hour: number;
  analysis_prompt: string;
  digest_prompt: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className={`tog ${on ? "on" : ""}`}
      role="switch" aria-checked={on} tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(!on); } }}
    />
  );
}

function Inner() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [recipients, setRecipients] = useState("");
  const [analysisPrompt, setAnalysisPrompt] = useState("");
  const [digestPrompt, setDigestPrompt] = useState("");
  const [label, setLabel] = useState({ name: "", color: "#4c6a63" });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, log] = await Promise.all([
        api<Settings>("/api/settings"),
        api<any[]>("/api/activity"),
      ]);
      setS(settings);
      setRecipients((settings.digest_recipients ?? []).join(", "));
      setAnalysisPrompt(settings.analysis_prompt ?? "");
      setDigestPrompt(settings.digest_prompt ?? "");
      setActivity(log);
    } catch (e: any) { toast(e.message, "err"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<Settings>, note?: string) {
    try {
      const next = await api<Settings>("/api/settings", { method: "PATCH", body: patch });
      setS(next);
      if (note) toast(note);
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function saveRecipients() {
    const list = recipients.split(",").map((x) => x.trim()).filter(Boolean);
    await save({ digest_recipients: list }, `Digest goes to ${list.length} address${list.length === 1 ? "" : "es"}.`);
  }

  async function sendTest() {
    setSending(true);
    try {
      const r = await api<{ sent: boolean; reason?: string }>("/api/digest", { method: "POST" });
      toast(r.sent ? "Digest sent. Check your inbox." : r.reason ?? "Nothing sent.", r.sent ? "ok" : "err");
      await load();
    } catch (e: any) { toast(e.message, "err"); }
    setSending(false);
  }

  async function addLabel() {
    if (!label.name.trim() || !s) return;
    await save({ custom_labels: [...s.custom_labels, { ...label, name: label.name.trim() }] }, "Label added.");
    setLabel({ name: "", color: "#4c6a63" });
  }

  async function removeLabel(name: string) {
    if (!s) return;
    await save({ custom_labels: s.custom_labels.filter((l) => l.name !== name) });
  }

  if (!s) {
    return (
      <div id="shell">
        <TopBar />
        <div className="page"><div className="page-card"><div className="skeleton" style={{ height: 200 }} /></div></div>
      </div>
    );
  }

  const sections = s.digest_sections ?? {};

  return (
    <div id="shell">
      <TopBar />
      <div className="page">
        <div className="page-card">
          <h2>Settings</h2>
          <div className="page-sub">How the reminders, emails, and labels behave.</div>

          {/* reminders */}
          <div className="sect">
            <div className="sect-title">Cliq reminders</div>
            <div className="sect-desc">
              Assignees get a direct message until the item is closed. The pace picks up as a deadline approaches.
            </div>

            <div className="fld">
              <label htmlFor="base">How often, normally</label>
              <select id="base" value={s.reminder_base}
                onChange={(e) => save({ reminder_base: e.target.value })}>
                <option value="daily">Once a day</option>
                <option value="2days">Every other day</option>
                <option value="weekdays">Weekdays only</option>
              </select>
            </div>

            <div className="fld fld-2">
              <div>
                <label htmlFor="esc">Pick up the pace when a deadline is within</label>
                <select id="esc" value={s.escalate_within_days}
                  onChange={(e) => save({ escalate_within_days: Number(e.target.value) })}>
                  <option value={2}>2 days</option>
                  <option value={3}>3 days</option>
                  <option value={5}>5 days</option>
                  <option value={7}>7 days</option>
                </select>
              </div>
              <div>
                <label htmlFor="escf">Then message</label>
                <select id="escf" value={s.reminder_escalated}
                  onChange={(e) => save({ reminder_escalated: e.target.value })}>
                  <option value="twice_daily">Twice a day</option>
                  <option value="every_4h">Every four hours</option>
                  <option value="hourly">Every hour</option>
                </select>
              </div>
            </div>

            <div className="fld fld-2">
              <div>
                <label htmlFor="dmstart">Only send between</label>
                <select id="dmstart" value={s.dm_start_hour ?? 9}
                  onChange={(e) => save({ dm_start_hour: Number(e.target.value) }, "Send window updated.")}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dmend">and</label>
                <select id="dmend" value={s.dm_end_hour ?? 17}
                  onChange={(e) => save({ dm_end_hour: Number(e.target.value) }, "Send window updated.")}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: -6, marginBottom: 16 }}>
              No reminder goes out before or after these hours, {zoneLabel()} time.
              Resending from the Deadlines tab ignores this.
            </div>

            <div className="tog-row">
              <div>
                <div className="tog-k">Raise it in the group channel if nobody replies</div>
                <div className="tog-sub">After three unanswered direct messages</div>
              </div>
              <Toggle on={s.mention_in_group} onChange={(v) => save({ mention_in_group: v })} />
            </div>
            <div className="tog-row">
              <div>
                <div className="tog-k">Message the project owner once a deadline passes</div>
                <div className="tog-sub">A separate DM, not a copy of the assignee's</div>
              </div>
              <Toggle on={s.copy_manager} onChange={(v) => save({ copy_manager: v })} />
            </div>
            <div className="tog-row">
              <div>
                <div className="tog-k">Message straight away when a roadblock opens</div>
                <div className="tog-sub">Doesn't wait for the next scheduled run</div>
              </div>
              <Toggle on={s.notify_on_roadblock} onChange={(v) => save({ notify_on_roadblock: v })} />
            </div>
            <div className="tog-row">
              <div>
                <div className="tog-k">Keep nudging while a roadblock is open</div>
                <div className="tog-sub">Stops the moment it's marked resolved</div>
              </div>
              <Toggle on={s.nudge_open_roadblocks} onChange={(v) => save({ nudge_open_roadblocks: v })} />
            </div>
          </div>

          {/* deadline window */}
          <div className="sect">
            <div className="sect-title">Nearing deadlines</div>
            <div className="sect-desc">
              How far ahead the Deadlines tab looks. Overdue items always show,
              whatever this is set to.
            </div>
            <div className="fld" style={{ maxWidth: 220 }}>
              <label htmlFor="nearing">Show items due within</label>
              <select id="nearing" value={s.nearing_days ?? 5}
                onChange={(e) => save({ nearing_days: Number(e.target.value) }, "Window updated.")}>
                {[2, 3, 5, 7, 10, 14, 21, 30].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>
          </div>

          {/* analysis prompt */}
          <div className="sect">
            <div className="sect-title">Analysis</div>
            <div className="sect-desc">
              How Gemini should read each project. Leave this blank and it works as it does now —
              anything you write here is added to its instructions, so you steer the emphasis
              rather than replacing it.
            </div>
            <div className="fld">
              <textarea
                rows={4}
                value={analysisPrompt}
                placeholder="e.g. Be blunt about slipping deadlines. Flag anyone owning more than three open items. Write in Taglish when it reads more naturally."
                onChange={(e) => setAnalysisPrompt(e.target.value)}
                onBlur={() => save({ analysis_prompt: analysisPrompt }, "Analysis instructions saved.")}
              />
            </div>
          </div>

          {/* digest */}
          <div className="sect">
            <div className="sect-title">Weekly email</div>
            <div className="sect-desc">A progress summary sent from your Gmail account.</div>

            <div className="fld fld-2">
              <div>
                <label htmlFor="day">Day</label>
                <select id="day" value={s.digest_day}
                  onChange={(e) => save({ digest_day: Number(e.target.value) })}>
                  {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="hour">Time ({zoneLabel()})</label>
                <select id="hour" value={s.digest_hour}
                  onChange={(e) => save({ digest_hour: Number(e.target.value) })}>
                  {[7, 8, 9, 10, 16, 17].map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="fld">
              <label htmlFor="rcp">Who receives it</label>
              <textarea id="rcp" rows={2} value={recipients}
                placeholder="name@ececonsultinggroup.com, another@ece.com"
                onChange={(e) => setRecipients(e.target.value)}
                onBlur={saveRecipients} />
            </div>

            {[
              ["progress", "Progress on each project"],
              ["roadblocks", "Open roadblocks"],
              ["overdue", "Overdue action items"],
              ["ai", "A written summary from Gemini"],
            ].map(([key, text]) => (
              <div className="tog-row" key={key}>
                <div className="tog-k">{text}</div>
                <Toggle
                  on={sections[key] !== false}
                  onChange={(v) => save({ digest_sections: { ...sections, [key]: v } })}
                />
              </div>
            ))}

            {sections.ai !== false && (
              <div className="fld" style={{ marginTop: 14 }}>
                <label htmlFor="digestPrompt">How the written summary should read</label>
                <textarea
                  id="digestPrompt"
                  rows={3}
                  value={digestPrompt}
                  placeholder="e.g. Keep it to three sentences, lead with what needs my attention, skip the projects that are on track."
                  onChange={(e) => setDigestPrompt(e.target.value)}
                  onBlur={() => save({ digest_prompt: digestPrompt }, "Summary instructions saved.")}
                />
              </div>
            )}

            <button className="btn" style={{ marginTop: 16 }} onClick={sendTest} disabled={sending}>
              {sending ? "Sending…" : "Send one now"}
            </button>
          </div>

          {/* labels */}
          <div className="sect">
            <div className="sect-title">Labels</div>
            <div className="sect-desc">
              Priority, Shared, and the date labels are built in. Add your own below.
            </div>

            <div className="chips">
              <span className="chip locked"><span className="dot" style={{ background: "var(--orange)" }} />Priority</span>
              <span className="chip locked"><span className="dot" style={{ background: "var(--ink-3)" }} />Shared</span>
              <span className="chip locked"><span className="dot" style={{ background: "var(--sage)" }} />Due date</span>
              <span className="chip locked"><span className="dot" style={{ background: "var(--red)" }} />Late</span>
            </div>

            {s.custom_labels.length > 0 && (
              <div className="chips">
                {s.custom_labels.map((l) => (
                  <span key={l.name} className="chip">
                    <span className="dot" style={{ background: l.color }} />
                    {l.name}
                    <span className="x" role="button" tabIndex={0}
                      onClick={() => removeLabel(l.name)}>✕</span>
                  </span>
                ))}
              </div>
            )}

            <div className="inline-form">
              <input placeholder="Label name" value={label.name}
                onChange={(e) => setLabel({ ...label, name: e.target.value })}
                style={{ flex: 1, minWidth: 170 }} />
              <input type="color" value={label.color}
                onChange={(e) => setLabel({ ...label, color: e.target.value })}
                aria-label="Label colour"
                style={{ width: 40, height: 36, padding: 2, cursor: "pointer", borderRadius: 9 }} />
              <button className="btn" onClick={addLabel}>Add</button>
            </div>
          </div>

          {/* activity */}
          <div className="sect">
            <div className="sect-title">Recent activity</div>
            <div className="sect-desc">What the automations have done lately.</div>
            {activity.length === 0 && <div className="empty">Nothing yet.</div>}
            {activity.map((a) => (
              <div key={a.id} className="log-item">
                <b>{a.summary}</b>
                <div className="log-t">
                  {formatInZone(a.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <ToastHost><Inner /></ToastHost>; }
