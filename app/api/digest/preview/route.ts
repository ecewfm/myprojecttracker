import { NextResponse } from "next/server";
import { db, log } from "@/lib/supabase";
import { isSignedIn } from "@/lib/auth";
import { buildDigest } from "@/lib/digest";
import { sendMail } from "@/lib/google";

export const maxDuration = 120;

/** The weekly email exactly as it would arrive, without sending it. */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { subject, html, recipients } = await buildDigest();
  return NextResponse.json({ subject, html, recipients });
}

/** Send it now, whatever the cadence setting says. */
export async function POST() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { subject, html, recipients } = await buildDigest();
  if (!recipients.length) {
    return NextResponse.json(
      { error: "No recipients set. Add them under Settings → weekly email." },
      { status: 400 }
    );
  }

  await sendMail(recipients, subject, html);
  await log("digest", `Weekly email sent by hand to ${recipients.length} recipient(s)`);

  return NextResponse.json({ sent: recipients.length });
}
