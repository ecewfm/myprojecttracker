# ECE Projects

A single-user project tracker: kanban board, milestones with notes, roadblocks with
status, escalating Cliq reminders, a weekly Gmail digest, Gemini analysis, and
Calendar scheduling.

Next.js 14 · Supabase · Vercel

---

## Launch it

Work through these in order. Steps 1–4 get you a running board; 5–8 turn the
automations on. **You can deploy after step 4** and add the integrations later —
the app runs fine without them, the buttons just report that a key is missing.

Set aside about 90 minutes for the whole thing.

---

### 1 · Supabase — the database

1. Go to [supabase.com](https://supabase.com) → **New project**.
   Name it `ece-projects`, pick **Southeast Asia (Singapore)** for the region,
   and set a database password (save it somewhere; you won't need it again here).
2. Wait for provisioning, roughly two minutes.
3. Open **SQL Editor** → **New query**. Paste the entire contents of
   `supabase/schema.sql` and press **Run**. It should report success with no rows.
4. Go to **Project Settings** → **API** and copy two values:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role** key (under "Project API keys", click reveal) → `SUPABASE_SERVICE_ROLE_KEY`

> The service_role key bypasses row-level security. It only ever lives in your
> Vercel environment variables and is never sent to the browser. Don't put it in
> any file you commit.

---

### 2 · Push the code to GitHub

```bash
cd ece-projects
git init
git add .
git commit -m "ECE Projects"
gh repo create ece-projects --private --source=. --push
```

No `gh` CLI? Create an empty private repo on github.com, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/ece-projects.git
git branch -M main
git push -u origin main
```

---

### 3 · Deploy to Vercel

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → import `ece-projects`.
2. Framework preset auto-detects as Next.js. Leave the build settings alone.
3. Before clicking Deploy, open **Environment Variables** and add these four:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
| `APP_USERNAME` | whatever you want to type at the login screen |
| `APP_PASSWORD` | a long one — this is the only thing between the internet and your data |

4. Generate two secrets in your terminal and add them too:

```bash
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → CRON_SECRET
```

5. Click **Deploy**. When it finishes, copy the URL it gives you
   (e.g. `ece-projects.vercel.app`), add one more variable `APP_URL` set to
   `https://` + that URL, and redeploy.

You can sign in now. The board will be empty.

---

### 4 · First run

Sign in and click **New project**. It creates a project with the ten standard
milestones. Open the card and you'll see the panel: progress, roadblocks,
milestones with notes, action items.

Before assigning anything, add people. Go to **Team** → "Add someone manually"
and enter a name and their `@ececonsultinggroup.com` address. (Step 5 replaces
this with an automatic sync.)

**Everything below is optional.** Add integrations one at a time and test each
before moving to the next — that way a failure has one obvious cause.

---

### 5 · Zoho — Cliq reminders and the roster sync

Both use the same OAuth token.

**Create the OAuth client**

1. Go to [api-console.zoho.com](https://api-console.zoho.com) → **Add Client** →
   **Self Client** (it needs no redirect URL and no review).
2. Note the **Client ID** and **Client Secret**.
3. Switch to the **Generate Code** tab and enter this scope, all on one line:

```
ZohoCliq.Messages.CREATE,ZohoCliq.Buddies.READ,ZohoCreator.report.READ
```

4. Set duration to 10 minutes, put anything in the description, click **Create**.
   Copy the code it shows — it expires quickly, so do the next step right away.

**Trade the code for a refresh token**

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=THE_CODE_YOU_JUST_COPIED"
```

The response contains `refresh_token`. That one doesn't expire — save it.

**Add to Vercel**

```
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN
ZOHO_ACCOUNTS_URL      = https://accounts.zoho.com
ZOHO_CREATOR_BASE      = https://creator.zoho.com
ZOHO_CREATOR_OWNER     = ececonsultinggroup
ZOHO_CREATOR_APP       = ece-time-tracker
ZOHO_CREATOR_REPORT    = View_Employees_View_Only
```

Redeploy, then go to **Team** → **Sync now**.

**If the sync returns rows but no names**, the field names in your Employees form
differ from the guesses. Open `lib/zoho.ts`, find `fetchRoster`, and adjust these
two lines to match your actual field names:

```ts
const email = r.Email_Address || r.Email || r.Zoho_Email || r.Work_Email || "";
const name  = r.Employee_Name?.display_value || ... ;
```

To see the real field names, run the report's API URL in your browser while
signed in to Zoho, or check the form builder.

---

### 6 · Google — Gmail digest and Calendar

1. [console.cloud.google.com](https://console.cloud.google.com) → new project,
   call it `ece-projects`.
2. **APIs & Services** → **Library** → enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen** → External → fill in the app name and your email →
   add yourself under **Test users**. Leave it in Testing mode; you don't need
   verification for a single user.
4. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
   Under Authorised redirect URIs add:
   `https://developers.google.com/oauthplayground`
   Save the **Client ID** and **Client Secret**.

**Get a refresh token**

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon (top right) → tick **Use your own OAuth credentials** →
   paste your client ID and secret.
3. In the left panel, paste these two scopes into the "Input your own scopes" box:

```
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.events
```

4. **Authorize APIs** → sign in as your ECE account → allow.
5. **Exchange authorization code for tokens** → copy the **Refresh token**.

**Add to Vercel**

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_REDIRECT_URI = https://developers.google.com/oauthplayground
GMAIL_SENDER        = joriz.cruz@ececonsultinggroup.com
```

Redeploy, then **Settings** → set your recipients → **Send one now**.

---

### 7 · Gemini

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key**.
2. Add to Vercel:

```
GEMINI_API_KEY
GEMINI_MODEL = gemini-2.0-flash
```

Redeploy. Open any project and click **Run analysis** in the panel.

---

### 8 · Turn the schedules on

`vercel.json` already declares two cron jobs, so Vercel registers them on deploy.
Confirm under **Project** → **Settings** → **Cron Jobs**:

| Path | Schedule (UTC) | Manila time |
|---|---|---|
| `/api/cron/reminders` | `0 1,8 * * 1-5` | 9am and 4pm, weekdays |
| `/api/cron/digest` | `0 1 * * 5` | 9am Friday |

Both check `CRON_SECRET` before doing anything, so nobody can trigger them by
visiting the URL.

The cron runs twice daily regardless; the app decides who actually gets a message
based on your Settings. That means changing the cadence in Settings takes effect
immediately, with no redeploy.

> Hobby plan allows two cron jobs on a daily schedule. The twice-daily reminder
> schedule needs a Pro plan. On Hobby, change the schedule in `vercel.json` to
> `0 1 * * 1-5` and set the escalated frequency in Settings to "Twice a day" —
> the second message just won't fire until you upgrade.

---

## How the reminders decide who to message

Every cron run, the app looks at each open action item and roadblock and asks
whether enough time has passed since the last message:

- **Normal:** the base cadence from Settings — daily by default.
- **Deadline within N days** (default 3): switches to the escalated cadence,
  twice daily by default.
- **Any open roadblock:** always uses the escalated cadence, deadline or not.
  A blocker sitting untouched is the thing worth interrupting someone about.
- **Three unanswered messages:** if you've turned on group mentions, it raises
  the item in the channel named in `CLIQ_GROUP_CHANNEL`.

Marking a roadblock **Resolved** stops its reminders immediately. Marking it
**Escalated** sends one message right away to the owner, and to the project owner
too if "Message the project owner" is on.

---

## Local development

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

Open http://localhost:3000.

To test a cron route by hand:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/reminders
```

---

## When something breaks

**Login loops back to the sign-in page.** `SESSION_SECRET` is missing or changed
between deploys. Set it and sign in again.

**Board loads but is empty and shows no error.** Check Vercel → Logs. Usually the
schema hasn't been run, or `SUPABASE_SERVICE_ROLE_KEY` is the anon key by mistake.

**Cliq messages don't arrive.** The email in Team has to match the person's Zoho
account exactly. Check Vercel logs for the response body — Zoho names the problem
in it. A `401` means the refresh token was revoked; generate a new one.

**Digest doesn't send.** Gmail API refuses if the consent screen doesn't list you
as a test user, or if the refresh token was issued for scopes that didn't include
`gmail.send`. Redo step 6 and check both.

**Gemini returns 400.** The model name changes over time. Try
`gemini-2.0-flash-exp` or check the current list at ai.google.dev.

Every automation writes to **Settings → Recent activity**, so start there before
digging into logs.

---

## What's where

```
app/
  page.tsx              board
  roadblocks/           everything blocked, across projects
  settings/             cadence, digest, labels, activity
  team/                 roster and Zoho sync
  api/                  19 route handlers
components/
  Shell.tsx             nav, toast, fetch wrapper
  ProjectPanel.tsx      the detail panel
lib/
  data.ts               queries, shaping rows into Project
  reminders.ts          who gets nudged and when
  digest.ts             the weekly email
  zoho.ts               Cliq + Creator
  google.ts             Gmail + Calendar
  gemini.ts             analysis prompts
supabase/schema.sql     run once
```
