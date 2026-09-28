import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Builds an inspector-ready HACCP temperature log PDF from the session's
 * readings. Every row is a reading exactly as captured: the cook's words,
 * the parsed number, the deterministic verdict, and any corrective action.
 */
export function exportHaccpPdf(readings, { shiftStart, shiftEnd } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const generatedAt = new Date();

  doc.setFontSize(16);
  doc.text("TempCheck — HACCP-Style Temperature Log", 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Generated ${generatedAt.toLocaleString()}`, 40, 58);
  if (shiftStart) doc.text(`Shift started ${new Date(shiftStart).toLocaleString()}`, 40, 72);
  if (shiftEnd) doc.text(`Shift ended ${new Date(shiftEnd).toLocaleString()}`, 40, 86);

  const rows = readings.map((r) => [
    new Date(r.timestamp).toLocaleTimeString(),
    r.location || r.foodItem || "—",
    r.categoryLabel || "—",
    Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
    (r.status || "unknown").toUpperCase(),
    r.correctiveAction || "—",
    r.cookText || "—",
  ]);

  autoTable(doc, {
    startY: 100,
    head: [["Time", "Location / Item", "Category", "Temp", "Status", "Corrective Action", "Cook's Words"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 85 },
      2: { cellWidth: 75 },
      3: { cellWidth: 40 },
      4: { cellWidth: 45 },
      5: { cellWidth: 140 },
      6: { cellWidth: 110 },
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

  const flaggedCount = readings.filter((r) => r.status === "red" || r.status === "amber").length;
  const finalY = doc.lastAutoTable.finalY || 100;
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(
    `${readings.length} readings logged, ${flaggedCount} flagged for corrective action. All numbers above are exactly what the cook said and what was measured — none are estimated.`,
    40,
    finalY + 24,
    { maxWidth: 520 }
  );
  doc.setTextColor(120);
  doc.text(
    "Point-in-time temperature checks only. Does not automate cooling-curve time windows (e.g. 135°F→70°F within 2h) — log those manually until that feature ships.",
    40,
    finalY + 40,
    { maxWidth: 520 }
  );

  doc.save(`tempcheck-haccp-log-${generatedAt.toISOString().slice(0, 10)}.pdf`);
}
