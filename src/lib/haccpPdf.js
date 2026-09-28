import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const PAGE_WIDTH = 612; // US Letter, pt
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawFooter(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Page ${i} of ${pages}`, PAGE_WIDTH - MARGIN, 792 - 20, { align: "right" });
    doc.text("TempCheck — generated directly from spoken readings, not typed after the fact", MARGIN, 792 - 20);
  }
}

/**
 * Builds an inspector-ready HACCP-style temperature log PDF. Two sections,
 * in the order an inspector actually cares about them: violations and
 * corrective actions first (with the cook's exact spoken words as
 * evidence), then the complete log of every reading. `readings` should
 * already be filtered (by date/station) by the caller — this just renders
 * whatever it's given and prints `filterDescription` in the header so it's
 * clear the export isn't necessarily the whole shift.
 */
export function exportHaccpPdf(readings, { shiftStart, shiftEnd, filterDescription } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const generatedAt = new Date();

  // --- Letterhead-style header ---
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, 30, PAGE_WIDTH - MARGIN, 30);
  doc.setFontSize(18);
  doc.setTextColor(20);
  doc.text("HACCP-Style Temperature Log", MARGIN, 52);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text("TempCheck — voice-logged food-safety compliance record", MARGIN, 67);

  let y = 88;
  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text(`Generated: ${generatedAt.toLocaleString()}`, MARGIN, y);
  y += 13;
  if (shiftStart) {
    doc.text(
      `Shift: ${new Date(shiftStart).toLocaleString()} → ${shiftEnd ? new Date(shiftEnd).toLocaleString() : "(in progress)"}`,
      MARGIN,
      y
    );
    y += 13;
  }
  if (filterDescription) {
    doc.setTextColor(8, 100, 155);
    doc.text(`Filtered: ${filterDescription}`, MARGIN, y);
    doc.setTextColor(70);
    y += 13;
  }
  doc.setDrawColor(200);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 4, PAGE_WIDTH - MARGIN, y + 4);
  y += 18;

  // --- Section 1: corrective actions & violations, with spoken evidence ---
  const flagged = readings.filter((r) => r.status === "red" || r.status === "amber");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text("Corrective Actions & Violations", MARGIN, y);
  y += 6;

  if (flagged.length === 0) {
    doc.setFontSize(9.5);
    doc.setTextColor(70);
    doc.text("No amber or red readings this shift — nothing required a corrective action.", MARGIN, y + 14);
    y += 30;
  } else {
    autoTable(doc, {
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN },
      head: [["Time", "Location / Item", "Temp", "Status", "Corrective Action", "Spoken Evidence (cook's exact words)"]],
      body: flagged.map((r) => [
        new Date(r.timestamp).toLocaleTimeString(),
        r.location || r.foodItem || "—",
        Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
        (r.status || "unknown").toUpperCase(),
        r.correctiveAction || "—",
        r.cookText ? `"${r.cookText}"` : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [127, 29, 29] },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 90 },
        2: { cellWidth: 40 },
        3: { cellWidth: 42 },
        4: { cellWidth: 150 },
        5: { cellWidth: 152, fontStyle: "italic" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const v = String(data.cell.raw).toLowerCase();
          if (v === "red") data.cell.styles.textColor = [185, 28, 28];
          else if (v === "amber") data.cell.styles.textColor = [180, 120, 8];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // --- Section 2: full log ---
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(`Full Temperature Log (${readings.length} reading${readings.length === 1 ? "" : "s"})`, MARGIN, y);

  const rows = readings.map((r) => [
    new Date(r.timestamp).toLocaleTimeString(),
    (r.location || r.foodItem || "—") +
      (r.coolingStage ? ` (${r.coolingStage === "start" ? "cooling start" : "cooling check"})` : ""),
    r.categoryLabel || "—",
    Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
    (r.status || "unknown").toUpperCase(),
    r.correctiveAction || "—",
    r.citation || "—",
    r.cookText || "—",
  ]);

  autoTable(doc, {
    startY: y + 8,
    margin: { left: MARGIN, right: MARGIN },
    head: [
      ["Time", "Location / Item", "Category", "Temp", "Status", "Corrective Action", "FDA Section", "Cook's Words"],
    ],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 3.5, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 78 },
      2: { cellWidth: 58 },
      3: { cellWidth: 34 },
      4: { cellWidth: 38 },
      5: { cellWidth: 98 },
      6: { cellWidth: 78 },
      7: { cellWidth: 72 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        const v = String(data.cell.raw).toLowerCase();
        if (v === "red") data.cell.styles.textColor = [185, 28, 28];
        else if (v === "amber") data.cell.styles.textColor = [180, 120, 8];
        else if (v === "safe") data.cell.styles.textColor = [21, 128, 61];
      }
    },
  });

  const flaggedCount = flagged.length;
  let finalY = doc.lastAutoTable.finalY || y;
  // The summary/caveat/signature block needs ~110pt; start a fresh page
  // rather than letting it run off the bottom of a full last page.
  if (finalY > 792 - 110 - 30) {
    doc.addPage();
    finalY = 40;
  }
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(
    `${readings.length} readings logged, ${flaggedCount} flagged for corrective action. All numbers above are exactly what the cook said and what was measured — none are estimated.`,
    MARGIN,
    finalY + 22,
    { maxWidth: CONTENT_WIDTH }
  );
  doc.setTextColor(120);
  doc.text(
    "Cooling-curve checks (135°F→70°F within 2h, then →41°F within 6h total, FDA Food Code 3-501.14(A)) pair a \"cooling start\" reading with a later \"cooling check\" reading for the same item and assume the temperature only decreased in between — they don't independently confirm an intermediate point.",
    MARGIN,
    finalY + 38,
    { maxWidth: CONTENT_WIDTH }
  );

  // --- Manager sign-off line ---
  const signY = finalY + 70;
  doc.setDrawColor(120);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, signY, MARGIN + 220, signY);
  doc.line(MARGIN + 260, signY, MARGIN + 340, signY);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text("Reviewed by (manager signature)", MARGIN, signY + 12);
  doc.text("Date", MARGIN + 260, signY + 12);

  drawFooter(doc);

  const suffix = filterDescription ? "-filtered" : "";
  doc.save(`tempcheck-haccp-log-${generatedAt.toISOString().slice(0, 10)}${suffix}.pdf`);
}
