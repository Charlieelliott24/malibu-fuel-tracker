const STORAGE_KEY = "malibuFuelTracker:v1";
const SETTINGS_KEY = "malibuFuelTracker:settings";
const CLOUD_SYNC_URL = "/api/fuel-log";
const FORMULA_OFFSET = 114.610;
const FORMULA_SLOPE = 0.40945;
const DEFAULT_TANK_GALLONS = 48;
const DEFAULT_FUEL_PRICE_PER_LITRE = 2.0;
const DEFAULT_JERRY_LITRES = 20;
const LITRES_PER_GALLON = 3.78541;
const SMOOTHING_WINDOW = 3;
const CLOUD_SYNC_INTERVAL_MS = 30000;
const CLOUD_SAVE_DEBOUNCE_MS = 700;
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
  fuelPrice: document.querySelector("#fuelPrice"),
  jerrySize: document.querySelector("#jerrySize"),
  fillCost: document.querySelector("#fillCost"),
  fillLitres: document.querySelector("#fillLitres"),
  jerriesNeeded: document.querySelector("#jerriesNeeded"),
  jerryCost: document.querySelector("#jerryCost"),
  sessionCost: document.querySelector("#sessionCost"),
  sessionUsed: document.querySelector("#sessionUsed"),
  setSessionStart: document.querySelector("#setSessionStart"),
  clearSessionStart: document.querySelector("#clearSessionStart"),
  sessionStartLabel: document.querySelector("#sessionStartLabel"),
  historyBody: document.querySelector("#historyBody"),
  entryCount: document.querySelector("#entryCount"),
  emptyState: document.querySelector("#emptyState"),
  miniChart: document.querySelector("#miniChart"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
  copySummary: document.querySelector("#copySummary"),
  clearHistory: document.querySelector("#clearHistory"),
  syncStatus: document.querySelector("#syncStatus"),
  syncNow: document.querySelector("#syncNow"),
  installButton: document.querySelector("#installButton"),
};

let entries = loadEntries();
let settings = loadSettings();
let deferredInstallPrompt = null;
let cloudSaveTimer = null;
let isCloudSyncing = false;
let lastCloudSyncAt = null;

elements.tankSize.value = settings.tankGallons;
elements.fuelPrice.value = settings.fuelPricePerLitre;
elements.jerrySize.value = settings.jerryLitres;

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
  queueCloudSave();
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
    queueCloudSave();
    render();
  }
});

elements.fuelPrice.addEventListener("input", () => {
  const value = Number(elements.fuelPrice.value);
  if (Number.isFinite(value) && value >= 0) {
    settings.fuelPricePerLitre = value;
    saveSettings();
    queueCloudSave();
    render();
  }
});

elements.jerrySize.addEventListener("input", () => {
  const value = Number(elements.jerrySize.value);
  if (Number.isFinite(value) && value > 0) {
    settings.jerryLitres = value;
    saveSettings();
    queueCloudSave();
    render();
  }
});

elements.historyBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  entries = entries.filter((entry) => entry.id !== button.dataset.delete);
  saveEntries();
  queueCloudSave();
  render();
});

elements.setSessionStart.addEventListener("click", () => {
  const latest = entries[0];
  if (!latest) return;
  const percent = smoothedPercentForIndex(0);
  settings.sessionStart = {
    createdAt: new Date().toISOString(),
    entryCreatedAt: latest.createdAt,
    percent,
    gallons: gallonsForPercent(percent),
    raw: formatRaw(latest),
  };
  saveSettings();
  queueCloudSave();
  render();
});

elements.clearSessionStart.addEventListener("click", () => {
  settings.sessionStart = null;
  saveSettings();
  queueCloudSave();
  render();
});

elements.exportCsv.addEventListener("click", () => {
  const rows = [
    [
      "time",
      "raw_input",
      "raw_average",
      "estimate_percent",
      "smoothed_percent",
      "gallons_remaining",
      "litres_remaining",
      "fill_cost",
      "gauge_percent",
    ],
    ...entries.map((entry, index) => [
      entry.createdAt,
      entry.rawInput,
      entry.rawAverage,
      entry.percent,
      smoothedPercentForIndex(index),
      gallonsForPercent(smoothedPercentForIndex(index)),
      litresForGallons(gallonsForPercent(smoothedPercentForIndex(index))),
      fillCostForPercent(smoothedPercentForIndex(index)),
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
    queueCloudSave();
    elements.tankSize.value = settings.tankGallons;
    elements.fuelPrice.value = settings.fuelPricePerLitre;
    elements.jerrySize.value = settings.jerryLitres;
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
  const summary = `Malibu fuel estimate: ${formatPercent(smooth)} (${formatGallons(gallonsForPercent(smooth))} remaining). Fill-up estimate ${formatMoney(fillCostForPercent(smooth))}. Raw ${formatRaw(latest)} entered ${formatDate(latest.createdAt)}.`;
  await copyText(summary);
  elements.copySummary.textContent = "Copied";
  window.setTimeout(() => {
    elements.copySummary.textContent = "Copy Summary";
  }, 1200);
});

elements.clearHistory.addEventListener("click", () => {
  if (!entries.length) return;
  if (confirm("Clear all saved fuel entries for everyone?")) {
    entries = [];
    saveEntries();
    queueCloudSave();
    render();
  }
});

elements.syncNow.addEventListener("click", () => {
  syncFromCloud({ pushAfterMerge: true });
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
initCloudSync();

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
    elements.setSessionStart.disabled = true;
  } else {
    const smooth = smoothedPercentForIndex(0);
    elements.fuelFill.style.width = `${smooth}%`;
    elements.currentPercent.textContent = formatPercent(latest.percent);
    elements.currentGallons.textContent = `${formatGallons(gallonsForPercent(smooth))} remaining from ${settings.tankGallons} gal`;
    elements.smoothPercent.textContent = formatPercent(smooth);
    elements.gaugeStep.textContent = `${nearestGaugeStep(smooth)}%`;
    elements.sinceLast.textContent = formatSince(latest.createdAt);
    elements.copySummary.disabled = false;
    elements.setSessionStart.disabled = false;
  }

  elements.entryCount.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  renderMoney(latest);
  renderHistory();
  renderChart();
}

function renderMoney(latest) {
  if (!latest) {
    elements.fillCost.textContent = "--";
    elements.fillLitres.textContent = "Enter a reading first";
    elements.jerriesNeeded.textContent = "--";
    elements.jerryCost.textContent = "Based on saved jerry size";
    elements.sessionCost.textContent = "--";
    elements.sessionUsed.textContent = "Set a start point";
    elements.sessionStartLabel.textContent = settings.sessionStart ? "Waiting for a reading" : "No session start saved";
    elements.clearSessionStart.disabled = !settings.sessionStart;
    return;
  }

  const smooth = smoothedPercentForIndex(0);
  const remainingGallons = gallonsForPercent(smooth);
  const fillGallons = Math.max(0, settings.tankGallons - remainingGallons);
  const fillLitres = litresForGallons(fillGallons);
  const jerries = settings.jerryLitres > 0 ? fillLitres / settings.jerryLitres : 0;

  elements.fillCost.textContent = formatMoney(fillLitres * settings.fuelPricePerLitre);
  elements.fillLitres.textContent = `${formatLitres(fillLitres)} to full`;
  elements.jerriesNeeded.textContent = jerries ? jerries.toFixed(1) : "0.0";
  elements.jerryCost.textContent = `${formatMoney(settings.jerryLitres * settings.fuelPricePerLitre)} per jerry`;
  elements.clearSessionStart.disabled = !settings.sessionStart;

  if (!settings.sessionStart) {
    elements.sessionCost.textContent = "--";
    elements.sessionUsed.textContent = "Set a start point";
    elements.sessionStartLabel.textContent = "No session start saved";
    return;
  }

  const usedGallons = Math.max(0, settings.sessionStart.gallons - remainingGallons);
  const usedLitres = litresForGallons(usedGallons);
  elements.sessionCost.textContent = formatMoney(usedLitres * settings.fuelPricePerLitre);
  elements.sessionUsed.textContent = `${formatLitres(usedLitres)} since start`;
  elements.sessionStartLabel.textContent = `Started ${formatDate(settings.sessionStart.createdAt)} at ${formatPercent(settings.sessionStart.percent)}`;
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
      <td>${formatDelta(delta)}<span class="row-note">${formatDeltaCost(delta)}</span></td>
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
      fuelPricePerLitre: DEFAULT_FUEL_PRICE_PER_LITRE,
      jerryLitres: DEFAULT_JERRY_LITRES,
      sessionStart: null,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return {
      tankGallons: DEFAULT_TANK_GALLONS,
      fuelPricePerLitre: DEFAULT_FUEL_PRICE_PER_LITRE,
      jerryLitres: DEFAULT_JERRY_LITRES,
      sessionStart: null,
    };
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function initCloudSync() {
  setSyncStatus("Syncing cloud history...");
  syncFromCloud({ pushAfterMerge: true });
  window.setInterval(() => syncFromCloud(), CLOUD_SYNC_INTERVAL_MS);
}

async function syncFromCloud(options = {}) {
  if (isCloudSyncing) return;
  isCloudSyncing = true;
  elements.syncNow.disabled = true;

  try {
    const cloudState = await fetchCloudState();
    const merge = mergeCloudState(cloudState);

    if (merge.localChanged) {
      saveEntries();
      saveSettings();
      applySettingsToInputs();
      render();
    }

    if (merge.cloudChanged || options.pushAfterMerge) {
      await pushCloudState();
    }

    lastCloudSyncAt = new Date();
    setSyncStatus(`Cloud synced ${formatTime(lastCloudSyncAt)}`);
  } catch (error) {
    setSyncStatus("Cloud sync unavailable. Entries saved on this device.");
  } finally {
    isCloudSyncing = false;
    elements.syncNow.disabled = false;
  }
}

function queueCloudSave() {
  setSyncStatus("Cloud sync pending...");
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(async () => {
    try {
      await pushCloudState();
      lastCloudSyncAt = new Date();
      setSyncStatus(`Cloud synced ${formatTime(lastCloudSyncAt)}`);
    } catch {
      setSyncStatus("Cloud sync failed. Will retry automatically.");
    }
  }, CLOUD_SAVE_DEBOUNCE_MS);
}

async function fetchCloudState() {
  return cloudRequest("GET", `${CLOUD_SYNC_URL}?cacheBust=${Date.now()}`);
}

async function pushCloudState() {
  await cloudRequest("PUT", CLOUD_SYNC_URL, buildCloudState());
}

function cloudRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    request.setRequestHeader("Accept", "application/json");
    if (body) request.setRequestHeader("Content-Type", "application/json");

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Cloud request failed: ${request.status}`));
        return;
      }

      try {
        resolve(request.responseText ? JSON.parse(request.responseText) : null);
      } catch {
        reject(new Error("Cloud response was not valid JSON"));
      }
    };

    request.onerror = () => reject(new Error("Cloud request failed"));
    request.send(body ? JSON.stringify(body) : null);
  });
}

function buildCloudState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
    settings: cloudSettings(settings),
  };
}

function mergeCloudState(cloudState) {
  const cloudEntries = Array.isArray(cloudState.entries) ? cloudState.entries.filter(isValidEntry) : [];
  const mergedEntries = mergeEntries(entries, cloudEntries);
  const mergedSettings = {
    ...settings,
    ...normalizeCloudSettings(cloudState.settings),
  };

  const localChanged = JSON.stringify(entries) !== JSON.stringify(mergedEntries) || JSON.stringify(settings) !== JSON.stringify(mergedSettings);
  const cloudChanged =
    JSON.stringify(cloudEntries) !== JSON.stringify(mergedEntries) ||
    JSON.stringify(normalizeCloudSettings(cloudState.settings)) !== JSON.stringify(cloudSettings(mergedSettings));

  entries = mergedEntries;
  settings = mergedSettings;

  return { localChanged, cloudChanged };
}

function mergeEntries(localEntries, cloudEntries) {
  const byId = new Map();
  [...cloudEntries, ...localEntries].forEach((entry) => {
    byId.set(entry.id, entry);
  });

  return [...byId.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function cloudSettings(source) {
  return {
    tankGallons: source.tankGallons,
    fuelPricePerLitre: source.fuelPricePerLitre,
    jerryLitres: source.jerryLitres,
    sessionStart: source.sessionStart || null,
  };
}

function normalizeCloudSettings(cloudSettingsValue) {
  const incoming = cloudSettingsValue && typeof cloudSettingsValue === "object" ? cloudSettingsValue : {};
  return {
    tankGallons: Number.isFinite(Number(incoming.tankGallons)) && Number(incoming.tankGallons) > 0 ? Number(incoming.tankGallons) : settings.tankGallons,
    fuelPricePerLitre:
      Number.isFinite(Number(incoming.fuelPricePerLitre)) && Number(incoming.fuelPricePerLitre) >= 0
        ? Number(incoming.fuelPricePerLitre)
        : settings.fuelPricePerLitre,
    jerryLitres: Number.isFinite(Number(incoming.jerryLitres)) && Number(incoming.jerryLitres) > 0 ? Number(incoming.jerryLitres) : settings.jerryLitres,
    sessionStart: incoming.sessionStart || settings.sessionStart || null,
  };
}

function applySettingsToInputs() {
  elements.tankSize.value = settings.tankGallons;
  elements.fuelPrice.value = settings.fuelPricePerLitre;
  elements.jerrySize.value = settings.jerryLitres;
}

function setSyncStatus(message) {
  elements.syncStatus.textContent = message;
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

function litresForGallons(gallons) {
  return gallons * LITRES_PER_GALLON;
}

function fillCostForPercent(percent) {
  const remainingGallons = gallonsForPercent(percent);
  const fillGallons = Math.max(0, settings.tankGallons - remainingGallons);
  return litresForGallons(fillGallons) * settings.fuelPricePerLitre;
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

function formatLitres(value) {
  return `${value.toFixed(1)} L`;
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value);
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

function formatDeltaCost(delta) {
  if (delta === null || delta >= 0) return "";
  const gallonsUsed = settings.tankGallons * Math.abs(delta / 100);
  const cost = litresForGallons(gallonsUsed) * settings.fuelPricePerLitre;
  return `${formatMoney(cost)} used`;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
