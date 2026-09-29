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
    // Softened per Round-2 critique #P1-8: this used to assert "not typed
    // after the fact" on every page with nothing backing it up right here.
    // The actual backing (the hash chain + honest caveat about what it
    // does and doesn't prove) is in the body of the report — this footer
    // now just points there instead of repeating the claim unsupported.
    doc.text("TempCheck — generated from spoken readings. See \"Log integrity\" below for what's verified.", MARGIN, 792 - 20);
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
export function exportHaccpPdf(
  readings,
  {
    shiftStart,
    shiftEnd,
    filterDescription,
    integrity,
    establishmentName,
    thermometerId,
    lastCalibrationDate,
    cookName,
  } = {}
) {
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
  // Round-2 critique #P1-8: an inspector asks who took a reading, with
  // which thermometer, on which unit, and for which establishment. The
  // establishment name (when set in Settings) replaces the generic
  // subtitle so the report is identifiable at a glance, same as a real
  // paper HACCP log's letterhead.
  doc.text(
    establishmentName ? establishmentName : "TempCheck — voice-logged food-safety compliance record",
    MARGIN,
    67
  );

  let y = 88;
  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text(`Generated: ${generatedAt.toLocaleString()}`, MARGIN, y);
  y += 13;
  if (shiftStart) {
    doc.text(
      `Shift: ${new Date(shiftStart).toLocaleString()} to ${shiftEnd ? new Date(shiftEnd).toLocaleString() : "(in progress)"}`,
      MARGIN,
      y
    );
    y += 13;
  }
  if (cookName) {
    doc.text(`Logged by: ${cookName}`, MARGIN, y);
    y += 13;
  }
  if (thermometerId || lastCalibrationDate) {
    const parts = [];
    if (thermometerId) parts.push(`Thermometer: ${thermometerId}`);
    if (lastCalibrationDate) parts.push(`last calibrated ${new Date(lastCalibrationDate).toLocaleDateString()}`);
    doc.text(parts.join(", "), MARGIN, y);
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
  // Only "red" is an actual FDA Food Code violation. "Amber" is a
  // compliant reading close to the limit (see ruleEngine.js) — it gets a
  // spoken confirmation in the app, but it never required a corrective
  // action, so it doesn't belong in an inspector's violations section; it
  // still appears, correctly labeled, in the full log below.
  //
  // Round-3 critique #P0-1: a superseded (corrected-away) RED reading is
  // deliberately NOT excluded here — it was a real, logged FDA violation
  // when it happened, and a cook's own later spoken correction is not the
  // same thing as a manager confirming the corrective action actually
  // took place. Excluding it let a genuine violation vanish from an
  // inspector's copy of the log just because someone later said a
  // different number. It stays listed, with its "corrected by cook to
  // X°F" note appended to Corrective Action so an inspector — or a
  // manager reviewing before it's ever printed — sees it needs
  // confirming, not that it disappeared.
  const flagged = readings.filter((r) => r.status === "red");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text("Violations & Corrective Actions", MARGIN, y);
  y += 6;

  if (flagged.length === 0) {
    doc.setFontSize(9.5);
    doc.setTextColor(70);
    doc.text("No red (violation) readings this shift — nothing required a corrective action.", MARGIN, y + 14);
    y += 30;
  } else {
    autoTable(doc, {
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN },
      head: [
        ["Time", "Location / Item", "Temp", "Status", "Corrective Action", "Spoken Evidence (cook's exact words)", "Resolved"],
      ],
      body: flagged.map((r) => [
        new Date(r.timestamp).toLocaleTimeString(),
        r.location || r.foodItem || "—",
        Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
        (r.status || "unknown").toUpperCase() + (r.superseded ? " (corrected)" : ""),
        (r.correctiveAction || "—") + (r.superseded && r.supersededNote ? `\n${r.supersededNote}` : ""),
        r.cookText ? `"${r.cookText}"` : "—",
        r.resolvedAt ? `Yes, ${new Date(r.resolvedAt).toLocaleTimeString()}` : "No",
      ]),
      styles: { fontSize: 8, cellPadding: 3.5, overflow: "linebreak" },
      headStyles: { fillColor: [127, 29, 29] },
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 78 },
        2: { cellWidth: 34 },
        3: { cellWidth: 36 },
        4: { cellWidth: 130 },
        5: { cellWidth: 130, fontStyle: "italic" },
        6: { cellWidth: 52 },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const v = String(data.cell.raw).toLowerCase();
          if (v.startsWith("red")) data.cell.styles.textColor = [185, 28, 28];
          else if (v.startsWith("amber")) data.cell.styles.textColor = [180, 120, 8];
        }
        if (data.section === "body" && data.column.index === 6) {
          const v = String(data.cell.raw);
          data.cell.styles.textColor = v.startsWith("Yes") ? [21, 128, 61] : [185, 28, 28];
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
      (r.coolingStage ? ` (${r.coolingStage === "start" ? "cooling start" : "cooling check"})` : "") +
      (r.superseded ? " [SUPERSEDED — corrected]" : "") +
      (r.supersededNote ? `\n${r.supersededNote}` : r.correctionNote ? `\n${r.correctionNote}` : ""),
    // Code always wins the category the reading was actually evaluated
    // against (see foodCategories.js) — this just marks, for a manager's
    // review, the cases where the voice agent's own guess disagreed.
    // measurementType (ruleEngine.js) labels whether this was a storage
    // unit's air temperature or a specific food item's internal/product
    // temperature — a real inspector distinction, derived deterministically
    // from the category rather than asked as a new voice question.
    (r.categoryLabel || "—") +
      (r.measurementType ? ` (${r.measurementType === "air" ? "Air" : "Product"})` : "") +
      (r.categoryConflict ? " (⚠ category conflict)" : ""),
    Number.isFinite(r.temperatureF) ? `${r.temperatureF}°F` : "—",
    (r.status || "unknown").toUpperCase() + (r.superseded ? " (superseded)" : ""),
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

  // Both blocks below can wrap to more than one line (the caveat sentence
  // especially, and the summary sentence too once there are 2+ flagged
  // readings) — laying them out at fixed y-offsets assumed a single line
  // each and let a wrapped summary visually collide with the caveat text
  // right under it. Measure the real wrapped line counts first so every
  // block that follows is positioned from where the previous one actually
  // ended, not from a guess.
  const LINE_HEIGHT = 11.5;
  doc.setFontSize(9);
  const summaryLines = doc.splitTextToSize(
    `${readings.length} readings logged, ${flaggedCount} flagged for corrective action. All numbers above are exactly what the cook said and what was measured — none are estimated.`,
    CONTENT_WIDTH
  );
  const caveatLines = doc.splitTextToSize(
    "Cooling-curve checks (135°F to 70°F within 2h, then to 41°F within 6h total, FDA Food Code 3-501.14(A)) pair a \"cooling start\" reading with a later \"cooling check\" reading for the same item and assume the temperature only decreased in between — they don't independently confirm an intermediate point.",
    CONTENT_WIDTH
  );

  // Log integrity (Bug #5 / #26, reworded Round-3 #P0-4): honest about
  // what the hash chain proves and doesn't. See hashChain.js for the full
  // reasoning — this detects a NAIVE edit (a field changed in storage
  // without also regenerating every hash after it), and cross-checks that
  // every superseded/resolved flag matches a real, hashed correction/
  // resolution event (#P0-3) — it is not an unforgeable guarantee: anyone
  // willing to recompute the whole chain themselves, in their own
  // browser, could still regenerate a new internally-consistent one from
  // scratch. That would need a server-side secret this app doesn't have.
  const integrityHeadline = integrity
    ? integrity.verified
      ? "Log integrity: no naive edits detected — every entry's hash chains correctly from the start of this shift, and every correction/resolution matches its own hashed event."
      : `Log integrity: BROKEN at entry ${integrity.brokenAt} — ${integrity.reason}`
    : "Log integrity: not checked for this export.";
  const integrityCaveat =
    "This hash chain and the server-issued timestamps on each entry detect edits made without also regenerating the rest of the chain — the realistic tampering case. They are not an unforgeable guarantee (a full chain could in principle be regenerated from scratch by someone with complete control of their own browser) and do not prove a thermometer probe actually touched the food at the stated temperature.";
  const integrityLines = doc.splitTextToSize(integrityHeadline, CONTENT_WIDTH);
  const integrityCaveatLines = doc.splitTextToSize(integrityCaveat, CONTENT_WIDTH);

  const blockHeight =
    22 +
    summaryLines.length * LINE_HEIGHT +
    12 +
    caveatLines.length * LINE_HEIGHT +
    14 +
    integrityLines.length * LINE_HEIGHT +
    10 +
    integrityCaveatLines.length * LINE_HEIGHT +
    44;

  // Start a fresh page rather than letting this block run off the bottom
  // of a full last page.
  if (finalY + blockHeight > 792 - 30) {
    doc.addPage();
    finalY = 40;
  }

  doc.setTextColor(60);
  doc.text(summaryLines, MARGIN, finalY + 22);
  const afterSummaryY = finalY + 22 + summaryLines.length * LINE_HEIGHT;

  doc.setTextColor(120);
  doc.text(caveatLines, MARGIN, afterSummaryY + 12);
  const afterCaveatY = afterSummaryY + 12 + caveatLines.length * LINE_HEIGHT;

  doc.setFontSize(9.5);
  if (integrity && !integrity.verified) doc.setTextColor(185, 28, 28);
  else if (integrity && integrity.verified) doc.setTextColor(21, 128, 61);
  else doc.setTextColor(120);
  doc.text(integrityLines, MARGIN, afterCaveatY + 14);
  const afterIntegrityY = afterCaveatY + 14 + integrityLines.length * LINE_HEIGHT;

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(integrityCaveatLines, MARGIN, afterIntegrityY + 10);
  const afterIntegrityCaveatY = afterIntegrityY + 10 + integrityCaveatLines.length * LINE_HEIGHT;

  // --- Manager sign-off line ---
  const signY = afterIntegrityCaveatY + 30;
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
