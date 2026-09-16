import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isSignedIn } from "@/lib/auth";
import { buildPeopleUpdate } from "@/lib/people-update";
import { zoneToday } from "@/lib/tz";

export const maxDuration = 120;

/**
 * The same update as a spreadsheet.
 *
 * Laid out the way the email reads — one row per workstream, with the
 * programmer's name on the first of their rows only, so it looks like the
 * sheet people already keep by hand.
 */
export async function GET() {
  if (!(await isSignedIn())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { people, idle, unassigned } = await buildPeopleUpdate();

  const rows: any[][] = [[
    "Programmer", "Currently working on", "Project description",
    "How it's impacting the business", "Complete", "Status",
  ]];

  for (const person of people) {
    person.rows.forEach((r, i) => {
      rows.push([
        i === 0 ? person.name : "",          // blank on continuation rows
        r.headline,
        r.description,
        r.impact,
        r.percent === null ? "" : `${r.percent}%`,
        r.status,
      ]);
    });
  }

  if (idle.length) {
    rows.push([], ["Nothing open this week", idle.join(", ")]);
  }
  if (unassigned) {
    rows.push([], [`${unassigned} items have nobody assigned`]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 24 }, { wch: 34 }, { wch: 46 }, { wch: 68 }, { wch: 10 }, { wch: 14 },
  ];

  // Wrap the long columns, and freeze the header so scrolling keeps it.
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 1; r <= range.e.r; r++) {
    for (const c of [2, 3]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = { alignment: { wrapText: true, vertical: "top" } };
    }
  }
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Weekly update");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="WFM-weekly-update-${zoneToday()}.xlsx"`,
    },
  });
}
