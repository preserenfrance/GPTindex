const HISTORY_KEY = "gptindex-analysis-history";
const HISTORY_LIMIT = 10;
const DEFAULT_PROFILE = "general";
const DEFAULT_MODE = "analyze";

const PLAN_LABELS = {
  single_domain: "Single Domain Monitor",
  five_domains: "Growth Monitor"
};

const form = document.querySelector("#analyze-form");
const input = document.querySelector("#url-input");
const submitButton = document.querySelector("#submit-button");
const emailInput = document.querySelector("#email-input");
const emailReportButton = document.querySelector("#email-report");
const emailConsent = document.querySelector("#email-consent");
const emailFeedback = document.querySelector("#email-feedback");
const historyList = document.querySelector("#history-list");
const showPlansButton = document.querySelector("#show-plans");
const plansPage = document.querySelector("#plans-page");
const planButtons = document.querySelectorAll(".plan-button");
const plansFeedback = document.querySelector("#plans-feedback");

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
let latestRunMeta = {
  mode: DEFAULT_MODE,
  profile: DEFAULT_PROFILE,
  profileLabel: "Splošna stran"
};

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

function setPlansFeedback(message = "", tone = "success") {
  if (!plansFeedback) {
    return;
  }

  plansFeedback.textContent = message;
  plansFeedback.className = `plans-feedback ${tone}`;
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
  const value = input.value.trim();
  return value ? [value] : [];
}

function revealPlans(message = "") {
  plansPage.classList.remove("hidden");
  setPlansFeedback(message);
  plansPage.scrollIntoView({ behavior: "smooth", block: "start" });
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

function renderPrimaryResult(result) {
  scoreValue.textContent = String(result.score);
  scoreLabel.textContent = result.verdict.label;
  scoreLabel.className = `score-label ${result.verdict.tone}`;
  resultTitle.textContent = result.summary.title;
  resultDescription.textContent = result.summary.description;
  resultProfile.textContent = `Profil preverjanja: ${result.profileLabel}`;
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

async function createCheckoutSession(url, plan) {
  const params = new URLSearchParams({
    url,
    plan
  });

  return fetchJson(
    `/api/checkout-session?${params.toString()}`,
    "Stripe checkout ni uspel."
  );
}

async function sendEmailReport() {
  const email = emailInput.value.trim();
  if (!email) {
    setEmailFeedback("Vnesite email naslov za pošiljanje PDF poročila.", "error");
    emailInput.focus();
    return;
  }

  if (!latestResults.length) {
    setEmailFeedback("Najprej zaženite analizo.", "error");
    return;
  }

  if (!emailConsent.checked) {
    setEmailFeedback("Pred pošiljanjem morate potrditi soglasje za uporabo e-maila za obveščanje o novostih.", "error");
    emailConsent.focus();
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
    setEmailFeedback(`PDF poročilo je bilo uspešno poslano na ${response.sentTo}.`, "success");
  } catch (error) {
    setEmailFeedback(error instanceof Error ? error.message : "Pošiljanje emaila ni uspelo.", "error");
  } finally {
    emailReportButton.disabled = false;
    emailReportButton.textContent = "Pošlji PDF";
  }
}

async function verifyReturnedCheckout() {
  const currentUrl = new URL(window.location.href);
  const checkout = currentUrl.searchParams.get("checkout");
  const sessionId = currentUrl.searchParams.get("session_id");

  if (!checkout) {
    return;
  }

  plansPage.classList.remove("hidden");

  if (checkout === "cancelled") {
    setPlansFeedback("Plačilo je bilo preklicano. Paket lahko izberete znova.", "error");
  } else if (checkout === "success" && sessionId) {
    try {
      const data = await fetchJson(
        `/api/checkout-session-status?session_id=${encodeURIComponent(sessionId)}`,
        "Preverjanje Stripe plačila ni uspelo."
      );

      const planLabel = data.planLabel || PLAN_LABELS[data.plan] || "izbrani paket";
      if (data.isCheckoutComplete) {
        setPlansFeedback(`Naročilo za ${planLabel} je potrjeno. Kmalu vas kontaktiramo za nastavitev rednega spremljanja.`, "success");
      } else {
        setPlansFeedback("Stripe seja je bila ustvarjena, vendar plačilo še ni potrjeno.", "error");
      }
    } catch (error) {
      setPlansFeedback(error instanceof Error ? error.message : "Preverjanje Stripe plačila ni uspelo.", "error");
    }
  }

  currentUrl.searchParams.delete("checkout");
  currentUrl.searchParams.delete("session_id");
  window.history.replaceState({}, "", currentUrl);
  plansPage.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setBusyState(isBusy) {
  submitButton.disabled = isBusy;
  emailReportButton.disabled = isBusy || !latestResults.length;
  planButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  submitButton.textContent = isBusy ? "Analiziram ..." : "Analiziraj";
}

function persistCurrentRun(inputs, results) {
  const first = results[0];
  if (!first) {
    return;
  }

  latestRunMeta = {
    mode: DEFAULT_MODE,
    profile: DEFAULT_PROFILE,
    profileLabel: first.profileLabel
  };

  saveHistory({
    mode: DEFAULT_MODE,
    modeLabel: "Analiza URL-ja",
    profile: DEFAULT_PROFILE,
    profileLabel: first.profileLabel,
    inputs,
    inputPreview: inputs.join(", ").slice(0, 120),
    label: first.summary.title,
    date: new Date().toLocaleString("sl-SI"),
    topScore: first.score
  });
}

async function handlePlanCheckout(plan) {
  const seedUrl = getUrls()[0] || latestResults[0]?.url || "";

  if (!seedUrl) {
    plansPage.classList.remove("hidden");
    setPlansFeedback("Najprej vnesite URL naslov, da paket povežemo s pravo domeno.", "error");
    input.focus();
    return;
  }

  try {
    setBusyState(true);
    setPlansFeedback(`Preusmerjam na Stripe Checkout za ${PLAN_LABELS[plan] || "izbrani paket"} ...`);
    const checkout = await createCheckoutSession(seedUrl, plan);
    window.location.href = checkout.checkoutUrl;
  } catch (error) {
    setPlansFeedback(error instanceof Error ? error.message : "Stripe checkout ni uspel.", "error");
    setBusyState(false);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const urls = getUrls();
  if (!urls.length) {
    return;
  }

  latestResults = [];
  setBusyState(true);
  setEmailFeedback("");
  setPlansFeedback("");
  errorState.textContent = "";
  showState("loading");

  try {
    const results = await Promise.all(urls.map((url) => analyzeSingleUrl(url, DEFAULT_PROFILE)));
    results.sort((a, b) => b.score - a.score);
    latestResults = results;

    renderComparison(results);
    renderPrimaryResult(results[0]);
    renderMetrics(results[0].technicalSignals);
    renderChecks(results[0].checks);
    renderRecommendations(results[0].recommendations);
    persistCurrentRun(urls, results);

    emailReportButton.disabled = false;
    showState("result");
  } catch (error) {
    latestResults = [];
    emailReportButton.disabled = true;
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

  input.value = item.inputs[0] || "";
});

showPlansButton.addEventListener("click", () => {
  revealPlans();
});

planButtons.forEach((button) => {
  button.addEventListener("click", () => {
    handlePlanCheckout(button.dataset.plan || "single_domain");
  });
});

form.addEventListener("submit", handleSubmit);
emailReportButton.addEventListener("click", sendEmailReport);

renderHistory();
await verifyReturnedCheckout();
