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
    (r.location || r.foodItem || "—") + (r.coolingStage ? ` (${r.coolingStage === "start" ? "cooling start" : "cooling check"})` : ""),
    r.categoryLabel || "—",
    Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
    (r.status || "unknown").toUpperCase(),
    r.correctiveAction || "—",
    r.citation || "—",
    r.cookText || "—",
  ]);

  autoTable(doc, {
    startY: 100,
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
    "Cooling-curve checks (135°F→70°F within 2h, then →41°F within 6h total, FDA Food Code 3-501.14(A)) pair a \"cooling start\" reading with a later \"cooling check\" reading for the same item and assume the temperature only decreased in between — they don't independently confirm an intermediate point.",
    40,
    finalY + 40,
    { maxWidth: 520 }
  );

  doc.save(`tempcheck-haccp-log-${generatedAt.toISOString().slice(0, 10)}.pdf`);
}
