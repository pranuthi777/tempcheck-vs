"use client";

/**
 * A full-screen, one-glance kitchen display: the most recent reading in
 * giant text with a color-coded background, meant to be readable from
 * across a kitchen without walking up to a screen or picking up a tablet.
 * Purely a view over state owned by the main page — no voice/connection
 * logic here, so Start/End Shift still happen from the normal view.
 */
const BIG_BG = {
  safe: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  unknown: "bg-slate-700",
};

const BIG_LABEL = {
  safe: "SAFE",
  amber: "BORDERLINE",
  red: "VIOLATION",
  unknown: "UNKNOWN ITEM",
};

export default function BigDisplay({ latestReading, summary, isLive, onExit }) {
  const status = latestReading?.status || null;
  const bg = status ? BIG_BG[status] || BIG_BG.unknown : "bg-slate-900";

  return (
    <main className={`fixed inset-0 flex flex-col items-center justify-center ${bg} transition-colors`}>
      <button
        onClick={onExit}
        className="absolute top-4 right-4 px-4 py-2 rounded-lg bg-black/30 hover:bg-black/50 text-white font-semibold text-lg"
      >
        Exit big display
      </button>

      <div className="absolute top-4 left-4 flex items-center gap-2 text-white/90 text-lg font-semibold">
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            isLive ? "bg-white animate-pulse" : "bg-white/40"
          }`}
        />
        {isLive ? "Listening" : "Not listening"}
      </div>

      {!latestReading ? (
        <p className="text-white/90 text-4xl font-bold text-center px-8">
          No readings yet this shift.
          <br />
          <span className="text-2xl font-normal opacity-80">Call out a temperature to get started.</span>
        </p>
      ) : (
        <div className="text-center text-white px-8">
          <p className="text-3xl md:text-4xl font-semibold opacity-90 mb-2">
            {latestReading.location || latestReading.foodItem || "Reading"}
          </p>
          <p className="text-[16vw] md:text-[12rem] leading-none font-black tabular-nums">
            {Number.isFinite(latestReading.temperatureF) ? `${latestReading.temperatureF}°F` : "—"}
          </p>
          <p className="text-5xl md:text-6xl font-extrabold tracking-wide mt-4">
            {BIG_LABEL[status] || BIG_LABEL.unknown}
          </p>
          {latestReading.correctiveAction && (
            <p className="text-2xl md:text-3xl font-semibold mt-6 max-w-3xl mx-auto opacity-95">
              {latestReading.correctiveAction}
            </p>
          )}
        </div>
      )}

      <div className="absolute bottom-6 flex gap-6 text-white/90 text-xl font-semibold">
        <span>Safe {summary?.safe ?? 0}</span>
        <span>Amber {summary?.amber ?? 0}</span>
        <span>Red {summary?.red ?? 0}</span>
        <span>Unknown {summary?.unknown ?? 0}</span>
      </div>
    </main>
  );
}
