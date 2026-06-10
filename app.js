const STORAGE_KEY = "malibuFuelTracker:v1";
const SETTINGS_KEY = "malibuFuelTracker:settings";
const FORMULA_OFFSET = 114.610;
const FORMULA_SLOPE = 0.40945;
const DEFAULT_TANK_GALLONS = 48;
const SMOOTHING_WINDOW = 3;
const GAUGE_STEPS = [0, 13, 25, 37, 50, 62, 75, 87, 100];

const elements = {
  form: document.querySelector("#entryForm"),
  input: document.querySelector("#readingInput"),
  parseHint: document.querySelector("#parseHint"),
  fuelFill: document.querySelector("#fuelFill"),
  currentPercent: document.querySelector("#currentPercent"),
  currentGallons: document.querySelector("#currentGallons"),
  smoothPercent: document.querySelector("#smoothPercent"),
  gaugeStep: document.querySelector("#gaugeStep"),
  sinceLast: document.querySelector("#sinceLast"),
  tankSize: document.querySelector("#tankSize"),
  historyBody: document.querySelector("#historyBody"),
  entryCount: document.querySelector("#entryCount"),
  emptyState: document.querySelector("#emptyState"),
  miniChart: document.querySelector("#miniChart"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
  copySummary: document.querySelector("#copySummary"),
  clearHistory: document.querySelector("#clearHistory"),
  installButton: document.querySelector("#installButton"),
};

let entries = loadEntries();
let settings = loadSettings();
let deferredInstallPrompt = null;

elements.tankSize.value = settings.tankGallons;

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseReading(elements.input.value);

  if (!parsed) {
    elements.parseHint.textContent = "I could not find a raw fuel count. Try 120 or 102-125.";
    elements.parseHint.classList.add("error");
    return;
  }

  entries.unshift({
    id: createId(),
    createdAt: new Date().toISOString(),
    rawInput: elements.input.value.trim(),
    rawLow: parsed.low,
    rawHigh: parsed.high,
    rawAverage: parsed.average,
    gaugePercent: parsed.gaugePercent,
    percentLow: estimatePercent(parsed.high),
    percentHigh: estimatePercent(parsed.low),
    percent: estimatePercent(parsed.average),
  });

  saveEntries();
  elements.input.value = "";
  elements.parseHint.textContent = parsed.message;
  elements.parseHint.classList.remove("error");
  render();
});

elements.input.addEventListener("input", () => {
  const parsed = parseReading(elements.input.value);
  elements.parseHint.classList.toggle("error", elements.input.value.trim() && !parsed);
  elements.parseHint.textContent = parsed
    ? parsed.message
    : "Ranges are averaged automatically. You can paste notes too.";
});

elements.tankSize.addEventListener("change", () => {
  const value = Number(elements.tankSize.value);
  if (Number.isFinite(value) && value > 0) {
    settings.tankGallons = value;
    saveSettings();
    render();
  }
});

elements.historyBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  entries = entries.filter((entry) => entry.id !== button.dataset.delete);
  saveEntries();
  render();
});

elements.exportCsv.addEventListener("click", () => {
  const rows = [
    ["time", "raw_input", "raw_average", "estimate_percent", "smoothed_percent", "gallons_remaining", "gauge_percent"],
    ...entries.map((entry, index) => [
      entry.createdAt,
      entry.rawInput,
      entry.rawAverage,
      entry.percent,
      smoothedPercentForIndex(index),
      gallonsForPercent(smoothedPercentForIndex(index)),
      entry.gaugePercent ?? "",
    ]),
  ];
  downloadFile("malibu-fuel-history.csv", toCsv(rows), "text/csv");
});

elements.exportJson.addEventListener("click", () => {
  downloadFile(
    "malibu-fuel-backup.json",
    JSON.stringify({ entries, settings, exportedAt: new Date().toISOString() }, null, 2),
    "application/json"
  );
});

elements.importJson.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.entries)) throw new Error("Missing entries");
    entries = backup.entries.filter(isValidEntry);
    settings = { ...settings, ...(backup.settings || {}) };
    saveEntries();
    saveSettings();
    elements.tankSize.value = settings.tankGallons;
    render();
  } catch {
    alert("That backup file could not be imported.");
  } finally {
    event.target.value = "";
  }
});

elements.copySummary.addEventListener("click", async () => {
  const latest = entries[0];
  if (!latest) return;
  const smooth = smoothedPercentForIndex(0);
  const summary = `Malibu fuel estimate: ${formatPercent(smooth)} (${formatGallons(gallonsForPercent(smooth))} remaining). Raw ${formatRaw(latest)} entered ${formatDate(latest.createdAt)}.`;
  await copyText(summary);
  elements.copySummary.textContent = "Copied";
  window.setTimeout(() => {
    elements.copySummary.textContent = "Copy Summary";
  }, 1200);
});

elements.clearHistory.addEventListener("click", () => {
  if (!entries.length) return;
  if (confirm("Clear all saved fuel entries on this device?")) {
    entries = [];
    saveEntries();
    render();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});

elements.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  elements.installButton.hidden = true;
});

render();

function parseReading(input) {
  const text = input.trim();
  if (!text) return null;

  const gaugeMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const gaugePercent = gaugeMatch ? Number(gaugeMatch[1]) : null;
  const withoutGauge = text.replace(/\d+(?:\.\d+)?\s*%/g, " ");
  const rangeMatch = withoutGauge.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);

  let low;
  let high;

  if (rangeMatch) {
    low = Number(rangeMatch[1]);
    high = Number(rangeMatch[2]);
  } else {
    const values = [...withoutGauge.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    if (!values.length) return null;
    const likelyRawValues = values.filter((value) => value >= 25);
    const raw = likelyRawValues.at(-1) ?? values.at(-1);
    low = raw;
    high = raw;
  }

  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const sortedLow = Math.min(low, high);
  const sortedHigh = Math.max(low, high);
  const average = (sortedLow + sortedHigh) / 2;
  const percent = estimatePercent(average);
  const rangeText = sortedLow === sortedHigh ? `${average}` : `${sortedLow}-${sortedHigh}`;

  return {
    low: sortedLow,
    high: sortedHigh,
    average,
    gaugePercent,
    message: `Using raw ${rangeText} -> ${formatPercent(percent)} before smoothing.`,
  };
}

function estimatePercent(raw) {
  return clamp(FORMULA_OFFSET - FORMULA_SLOPE * raw, 0, 100);
}

function smoothedPercentForIndex(index) {
  const slice = entries.slice(index, index + SMOOTHING_WINDOW);
  if (!slice.length) return 0;
  const averageRaw = slice.reduce((sum, entry) => sum + entry.rawAverage, 0) / slice.length;
  return estimatePercent(averageRaw);
}

function render() {
  const latest = entries[0];

  if (!latest) {
    elements.fuelFill.style.width = "0%";
    elements.currentPercent.textContent = "--%";
    elements.currentGallons.textContent = "Enter a raw count to start";
    elements.smoothPercent.textContent = "--%";
    elements.gaugeStep.textContent = "--";
    elements.sinceLast.textContent = "--";
    elements.copySummary.disabled = true;
  } else {
    const smooth = smoothedPercentForIndex(0);
    elements.fuelFill.style.width = `${smooth}%`;
    elements.currentPercent.textContent = formatPercent(latest.percent);
    elements.currentGallons.textContent = `${formatGallons(gallonsForPercent(smooth))} remaining from ${settings.tankGallons} gal`;
    elements.smoothPercent.textContent = formatPercent(smooth);
    elements.gaugeStep.textContent = `${nearestGaugeStep(smooth)}%`;
    elements.sinceLast.textContent = formatSince(latest.createdAt);
    elements.copySummary.disabled = false;
  }

  elements.entryCount.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  renderHistory();
  renderChart();
}

function renderHistory() {
  elements.historyBody.textContent = "";

  if (!entries.length) {
    elements.historyBody.append(elements.emptyState.content.cloneNode(true));
    return;
  }

  entries.forEach((entry, index) => {
    const previous = entries[index + 1];
    const smooth = smoothedPercentForIndex(index);
    const delta = previous ? smooth - smoothedPercentForIndex(index + 1) : null;
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${formatDate(entry.createdAt)}<span class="row-note">${formatSince(entry.createdAt)}</span></td>
      <td><span class="raw-value"></span><span class="row-note"></span></td>
      <td>${formatPercent(entry.percent)}<span class="row-note">${formatRange(entry)}</span></td>
      <td>${formatPercent(smooth)}<span class="row-note">${formatGallons(gallonsForPercent(smooth))}</span></td>
      <td>${formatDelta(delta)}</td>
      <td><button class="delete-row" type="button" data-delete="${escapeAttribute(entry.id)}" title="Delete entry">Delete</button></td>
    `;
    row.children[1].querySelector(".raw-value").textContent = formatRaw(entry);
    row.children[1].querySelector(".row-note").textContent = entry.rawInput;
    elements.historyBody.append(row);
  });
}

function renderChart() {
  elements.miniChart.textContent = "";
  const points = [...entries].reverse().slice(-18);
  if (!points.length) {
    elements.miniChart.hidden = true;
    return;
  }

  elements.miniChart.hidden = false;
  points.forEach((entry) => {
    const bar = document.createElement("span");
    bar.style.height = `${Math.max(5, entry.percent)}%`;
    bar.title = `${formatDate(entry.createdAt)}: ${formatPercent(entry.percent)}`;
    elements.miniChart.append(bar);
  });
}

function loadEntries() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    return {
      tankGallons: DEFAULT_TANK_GALLONS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { tankGallons: DEFAULT_TANK_GALLONS };
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function isValidEntry(entry) {
  return entry && typeof entry.id === "string" && Number.isFinite(entry.rawAverage) && Number.isFinite(entry.percent);
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function gallonsForPercent(percent) {
  return (settings.tankGallons * percent) / 100;
}

function nearestGaugeStep(percent) {
  return GAUGE_STEPS.reduce((best, step) => {
    return Math.abs(step - percent) < Math.abs(best - percent) ? step : best;
  }, GAUGE_STEPS[0]);
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatGallons(value) {
  return `${value.toFixed(1)} gal`;
}

function formatRaw(entry) {
  return entry.rawLow === entry.rawHigh ? `${entry.rawAverage}` : `${entry.rawLow}-${entry.rawHigh}`;
}

function formatRange(entry) {
  if (Math.round(entry.percentLow) === Math.round(entry.percentHigh)) return "single reading";
  return `${formatPercent(entry.percentLow)}-${formatPercent(entry.percentHigh)} range`;
}

function formatDelta(delta) {
  if (delta === null) return "First entry";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatSince(isoDate) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(",")
    )
    .join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for file:// and older mobile browsers.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
