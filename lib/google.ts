import { google } from "googleapis";

/**
 * One OAuth client covers both Gmail and Calendar — they share a refresh token.
 */
function oauth() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "https://developers.google.com/oauthplayground"
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

export async function sendMail(to: string[], subject: string, html: string, cc?: string[]) {
  const gmail = google.gmail({ version: "v1", auth: oauth() });
  const from = process.env.GMAIL_SENDER!;

  const message = [
    `From: ECE Projects <${from}>`,
    `To: ${to.join(", ")}`,
    ...(cc && cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");

  const raw = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return true;
}

export async function createMeeting(opts: {
  title: string;
  description?: string;
  startISO: string;
  minutes: number;
  attendees: string[];
}) {
  const calendar = google.calendar({ version: "v3", auth: oauth() });
  const start = new Date(opts.startISO);
  const end = new Date(start.getTime() + opts.minutes * 60_000);

  const res = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    conferenceDataVersion: 1,
    requestBody: {
      summary: opts.title,
      description: opts.description,
      start: { dateTime: start.toISOString(), timeZone: "Asia/Manila" },
      end:   { dateTime: end.toISOString(),   timeZone: "Asia/Manila" },
      attendees: opts.attendees.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `ece-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  return {
    id: res.data.id,
    link: res.data.htmlLink,
    meet: res.data.hangoutLink,
  };
}
