const HISTORY_KEY = "gptindex-analysis-history";
const HISTORY_LIMIT = 10;
const STRIPE_UNLOCK_KEY = "gptindex-stripe-upgrade-session";
const FREE_CRAWL_LIMIT = 5;

const form = document.querySelector("#analyze-form");
const input = document.querySelector("#url-input");
const profileSelect = document.querySelector("#profile-select");
const modeSelect = document.querySelector("#mode-select");
const crawlLimitSelect = document.querySelector("#crawl-limit-select");
const submitButton = document.querySelector("#submit-button");
const emailInput = document.querySelector("#email-input");
const emailReportButton = document.querySelector("#email-report");
const emailConsent = document.querySelector("#email-consent");
const emailFeedback = document.querySelector("#email-feedback");
const historyList = document.querySelector("#history-list");
const upgradeButton = document.querySelector("#upgrade-button");
const upgradeStatus = document.querySelector("#upgrade-status");

const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const resultState = document.querySelector("#result-state");

const scoreValue = document.querySelector("#score-value");
const scoreLabel = document.querySelector("#score-label");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultProfile = document.querySelector("#result-profile");
const metricsGrid = document.querySelector("#metrics-grid");
const checksList = document.querySelector("#checks-list");
const recommendationsList = document.querySelector("#recommendations-list");
const comparisonBody = document.querySelector("#comparison-body");

let latestResults = [];
let latestRunMeta = { mode: "analyze", profileLabel: "Splošna stran" };
let unlockedCheckoutSessionId = localStorage.getItem(STRIPE_UNLOCK_KEY) || "";

emailReportButton.disabled = true;

function setEmailFeedback(message = "", tone = "success") {
  if (!message) {
    emailFeedback.textContent = "";
    emailFeedback.className = "email-feedback hidden";
    return;
  }

  emailFeedback.textContent = message;
  emailFeedback.className = `email-feedback ${tone}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showState(state) {
  emptyState.classList.toggle("hidden", state !== "empty");
  loadingState.classList.toggle("hidden", state !== "loading");
  errorState.classList.toggle("hidden", state !== "error");
  resultState.classList.toggle("hidden", state !== "result");
}

function getUrls() {
  return input.value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function updateUpgradeStatus(message = "") {
  if (message) {
    upgradeStatus.textContent = message;
    return;
  }

  const requestedLimit = Number(crawlLimitSelect.value);
  if (requestedLimit <= FREE_CRAWL_LIMIT) {
    upgradeStatus.textContent = "Trenutno si v brezplačnem načinu.";
  } else if (unlockedCheckoutSessionId) {
    upgradeStatus.textContent = "Premium crawl je odklenjen za to napravo.";
  } else {
    upgradeStatus.textContent = "Za več kot 5 strani je potreben Stripe Checkout.";
  }
}

function renderMetrics(technicalSignals) {
  const blockedAgents = technicalSignals.blockedAgents.length
    ? technicalSignals.blockedAgents.join(", ")
    : "Brez blokad";

  const metrics = [
    ["HTTP status", technicalSignals.status],
    ["Blokirani agenti", blockedAgents],
    ["Sitemap", technicalSignals.sitemapAvailable ? "Da" : "Ne"],
    ["Besede", technicalSignals.wordCount],
    ["Jezik", technicalSignals.lang || "Ni določen"],
    ["Schema", technicalSignals.structuredDataCount]
  ];

  metricsGrid.innerHTML = metrics
    .map(([label, value]) => {
      let tone = "good";
      if (label === "Blokirani agenti" && blockedAgents !== "Brez blokad") {
        tone = "weak";
      } else if ((label === "Sitemap" && value === "Ne") || (label === "Jezik" && value === "Ni določen")) {
        tone = "medium";
      }

      return `
        <article class="metric-card">
          <p class="metric-label">${escapeHtml(label)}</p>
          <p class="metric-value ${tone}">${escapeHtml(value)}</p>
        </article>
      `;
    })
    .join("");
}

function renderChecks(checks) {
  checksList.innerHTML = checks
    .map((check) => `
      <article class="check-card">
        <div class="check-topline">
          <h4>${escapeHtml(check.label)}</h4>
          <span class="check-badge ${check.passed ? "passed" : "failed"}">
            ${check.passed ? "OK" : "Manjka"}
          </span>
        </div>
        <p>${escapeHtml(check.details)}</p>
      </article>
    `)
    .join("");
}

function renderRecommendations(recommendations) {
  recommendationsList.innerHTML = recommendations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderComparison(results) {
  comparisonBody.innerHTML = results
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.url)}</td>
        <td>${escapeHtml(item.profileLabel)}</td>
        <td class="comparison-score">${escapeHtml(item.score)}</td>
        <td>${escapeHtml(item.technicalSignals.status)}</td>
        <td>${item.technicalSignals.blockedAgents.length ? escapeHtml(item.technicalSignals.blockedAgents.join(", ")) : "OK"}</td>
        <td>${item.technicalSignals.sitemapAvailable ? "Da" : "Ne"}</td>
        <td>${escapeHtml(item.technicalSignals.wordCount)}</td>
      </tr>
    `)
    .join("");
}

function renderPrimaryResult(result, meta = {}) {
  scoreValue.textContent = String(result.score);
  scoreLabel.textContent = result.verdict.label;
  scoreLabel.className = `score-label ${result.verdict.tone}`;
  resultTitle.textContent = result.summary.title;
  resultDescription.textContent = result.summary.description;

  const additions = [];
  additions.push(`Profil preverjanja: ${result.profileLabel}`);
  if (meta.mode === "crawl" && meta.crawledCount) {
    additions.push(`Crawl je pregledal ${meta.crawledCount} URL-jev`);
  }
  resultProfile.textContent = additions.join(" | ");
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const history = loadHistory();
  const nextHistory = [entry, ...history].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  if (!history.length) {
    historyList.innerHTML = '<p class="history-empty">Zgodovina je še prazna.</p>';
    return;
  }

  historyList.innerHTML = history
    .map(
      (item, index) => `
        <article class="history-item">
          <h4>${escapeHtml(item.label)}</h4>
          <p class="history-meta">
            ${escapeHtml(item.modeLabel)} | ${escapeHtml(item.profileLabel)} | ${escapeHtml(item.date)}
          </p>
          <p class="history-meta">${escapeHtml(item.inputPreview)}</p>
          <button type="button" data-history-index="${index}">Ponovno naloži</button>
        </article>
      `
    )
    .join("");
}

async function fetchJson(url, fallbackMessage, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${fallbackMessage} Strežnik ni vrnil JSON odgovora.`);
  }

  if (!response.ok) {
    const error = new Error(data?.error || fallbackMessage);
    Object.assign(error, data || {});
    throw error;
  }

  return data;
}

async function analyzeSingleUrl(url, profile) {
  return fetchJson(
    `/api/analyze?url=${encodeURIComponent(url)}&profile=${encodeURIComponent(profile)}`,
    `Analiza ni uspela za ${url}.`
  );
}

async function crawlDomain(url, profile, limit) {
  const params = new URLSearchParams({
    url,
    profile,
    limit: String(limit)
  });

  if (unlockedCheckoutSessionId) {
    params.set("checkoutSessionId", unlockedCheckoutSessionId);
  }

  return fetchJson(`/api/crawl?${params.toString()}`, `Crawl ni uspel za ${url}.`);
}

async function createCheckoutSession(url) {
  return fetchJson(
    `/api/checkout-session?url=${encodeURIComponent(url)}`,
    "Stripe checkout ni uspel."
  );
}

async function sendEmailReport() {
  const email = emailInput.value.trim();
  if (!email) {
    setEmailFeedback("Vnesite email naslov za pošiljanje PDF poročila.", "error");
    errorState.textContent = "Vnesite email naslov za pošiljanje PDF poročila.";
    showState("error");
    return;
  }

  if (!latestResults.length) {
    setEmailFeedback("Najprej zaženite analizo ali crawl.", "error");
    errorState.textContent = "Najprej zaženite analizo ali crawl.";
    showState("error");
    return;
  }

  if (!emailConsent.checked) {
    setEmailFeedback("Pred pošiljanjem morate potrditi soglasje za uporabo e-maila za obveščanje o novostih.", "error");
    errorState.textContent = "Potrdite soglasje za uporabo e-maila za obveščanje o novostih.";
    showState("error");
    return;
  }

  setEmailFeedback("");
  emailReportButton.disabled = true;
  emailReportButton.textContent = "Pošiljam ...";

  try {
    const response = await fetchJson("/api/email-report", "Pošiljanje emaila ni uspelo.", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        results: latestResults,
        mode: latestRunMeta.mode,
        profileLabel: latestRunMeta.profileLabel
      })
    });

    showState("result");
    errorState.textContent = "";
    setEmailFeedback(`PDF poročilo je bilo uspešno poslano na ${response.sentTo}.`, "success");
    upgradeStatus.textContent = `PDF poročilo je poslano na ${response.sentTo}, kopija pa na ${response.copiedTo}.`;
  } catch (error) {
    setEmailFeedback(error instanceof Error ? error.message : "Pošiljanje emaila ni uspelo.", "error");
    errorState.textContent = error instanceof Error ? error.message : "Pošiljanje emaila ni uspelo.";
    showState("error");
  } finally {
    emailReportButton.disabled = false;
    emailReportButton.textContent = "Pošlji PDF";
  }
}

async function verifyReturnedCheckout() {
  const url = new URL(window.location.href);
  const checkout = url.searchParams.get("checkout");
  const sessionId = url.searchParams.get("session_id");

  if (checkout !== "success" || !sessionId) {
    if (checkout === "cancelled") {
      updateUpgradeStatus("Plačilo je bilo preklicano.");
    }
    return;
  }

  const data = await fetchJson(
    `/api/checkout-session-status?session_id=${encodeURIComponent(sessionId)}`,
    "Preverjanje Stripe plačila ni uspelo."
  );

  if (data.isUpgradePaid) {
    unlockedCheckoutSessionId = sessionId;
    localStorage.setItem(STRIPE_UNLOCK_KEY, sessionId);
    updateUpgradeStatus("Plačilo uspešno. Premium crawl je odklenjen.");
  } else {
    updateUpgradeStatus("Plačilo ni bilo potrjeno.");
  }

  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", url);
}

function setBusyState(isBusy) {
  submitButton.disabled = isBusy;
  upgradeButton.disabled = isBusy;
  emailReportButton.disabled = isBusy || !latestResults.length;
  submitButton.textContent = isBusy ? "Analiziram ..." : "Analiziraj";
}

function persistCurrentRun(mode, profile, inputs, results) {
  const first = results[0];
  if (!first) {
    return;
  }

  latestRunMeta = {
    mode,
    profileLabel: first.profileLabel,
    profile
  };

  saveHistory({
    mode,
    modeLabel: mode === "crawl" ? "Samodejni crawl" : "Ročna analiza",
    profile,
    profileLabel: first.profileLabel,
    inputs,
    inputPreview: inputs.join(", ").slice(0, 120),
    label: first.summary.title,
    date: new Date().toLocaleString("sl-SI"),
    topScore: first.score
  });
}

async function handleUpgrade() {
  const urls = getUrls();
  const seedUrl = urls[0];

  if (!seedUrl) {
    updateUpgradeStatus("Najprej vnesi začetni URL za crawl.");
    return;
  }

  try {
    setBusyState(true);
    updateUpgradeStatus("Preusmerjam na Stripe Checkout ...");
    const checkout = await createCheckoutSession(seedUrl);
    window.location.href = checkout.checkoutUrl;
  } catch (error) {
    updateUpgradeStatus(error instanceof Error ? error.message : "Stripe checkout ni uspel.");
    setBusyState(false);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const urls = getUrls();
  const profile = profileSelect.value;
  const mode = modeSelect.value;
  const crawlLimit = Number(crawlLimitSelect.value);
  if (!urls.length) {
    return;
  }

  setBusyState(true);
  showState("loading");

  try {
    let results = [];
    let crawlMeta = null;

    if (mode === "crawl") {
      const crawlResult = await crawlDomain(urls[0], profile, crawlLimit);
      results = crawlResult.results;
      crawlMeta = { mode: "crawl", crawledCount: crawlResult.crawledCount };
    } else {
      results = await Promise.all(urls.map((url) => analyzeSingleUrl(url, profile)));
    }

    results.sort((a, b) => b.score - a.score);
    latestResults = results;

    renderComparison(results);
    renderPrimaryResult(results[0], crawlMeta || { mode: "analyze" });
    renderMetrics(results[0].technicalSignals);
    renderChecks(results[0].checks);
    renderRecommendations(results[0].recommendations);
    persistCurrentRun(mode, profile, mode === "crawl" ? [urls[0]] : urls, results);

    emailReportButton.disabled = false;
    updateUpgradeStatus();
    setEmailFeedback("");
    showState("result");
  } catch (error) {
    latestResults = [];
    emailReportButton.disabled = true;
    if (error instanceof Error && (error.requiresUpgrade || error.freeLimit)) {
      updateUpgradeStatus("Za izbran obseg crawla najprej opravi Stripe Checkout.");
    }
    errorState.textContent = error instanceof Error ? error.message : "Prišlo je do napake pri analizi.";
    showState("error");
  } finally {
    setBusyState(false);
  }
}

historyList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const historyIndex = target.getAttribute("data-history-index");
  if (historyIndex === null) {
    return;
  }

  const item = loadHistory()[Number(historyIndex)];
  if (!item) {
    return;
  }

  input.value = item.inputs.join("\n");
  profileSelect.value = item.profile;
  modeSelect.value = item.mode;
});

modeSelect.addEventListener("change", updateUpgradeStatus);
crawlLimitSelect.addEventListener("change", updateUpgradeStatus);
form.addEventListener("submit", handleSubmit);
upgradeButton.addEventListener("click", handleUpgrade);
emailReportButton.addEventListener("click", sendEmailReport);

renderHistory();
updateUpgradeStatus();
await verifyReturnedCheckout();
