const TOKEN_KEY = "gptindex-admin-token";

const loginForm = document.querySelector("#admin-login");
const tokenInput = document.querySelector("#admin-token");
const clearTokenButton = document.querySelector("#clear-token");
const refreshButton = document.querySelector("#refresh-admin");
const feedback = document.querySelector("#admin-feedback");
const metricsGrid = document.querySelector("#metrics-grid");
const priceCards = document.querySelector("#price-cards");
const subscriptionsBody = document.querySelector("#subscriptions-body");
const checkoutBody = document.querySelector("#checkout-body");

let isLoading = false;

function getToken() {
  return tokenInput.value.trim() || sessionStorage.getItem(TOKEN_KEY) || "";
}

function setFeedback(message = "", tone = "neutral") {
  feedback.textContent = message;
  feedback.className = `admin-feedback ${tone}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "Ni podatka";
  }

  return new Intl.DateTimeFormat("sl-SI", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusLabel(status) {
  const labels = {
    active: "Aktivna",
    trialing: "Trial",
    past_due: "Zamuja",
    unpaid: "Neplačana",
    incomplete: "Nedokončana",
    canceled: "Preklicana",
    complete: "Zaključeno",
    open: "Odprto",
    expired: "Poteklo",
    paid: "Plačano",
    no_payment_required: "Brez plačila"
  };

  return labels[status] || status || "Neznano";
}

function renderMetrics(metrics = {}) {
  const cards = [
    ["Aktivne naročnine", metrics.activeSubscriptions ?? 0, "blue"],
    ["Ocenjen MRR", metrics.estimatedMrrDisplay || "0,00 EUR", "orange"],
    ["Kapaciteta domen", metrics.estimatedDomainCapacity ?? 0, "blue"],
    ["Težavne naročnine", metrics.problemSubscriptions ?? 0, "gray"],
    ["Zaključeni checkouti", metrics.completedCheckoutSessions ?? 0, "blue"],
    ["Odprti checkouti", metrics.openCheckoutSessions ?? 0, "gray"]
  ];

  metricsGrid.innerHTML = cards
    .map(([label, value, tone]) => `
      <article class="metric-card ${tone}">
        <p>${escapeHtml(label)}</p>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `)
    .join("");
}

function renderPrices(prices = []) {
  if (!prices.length) {
    priceCards.innerHTML = '<article class="price-card"><p>Ni konfiguriranih naročniških paketov.</p></article>';
    return;
  }

  priceCards.innerHTML = prices
    .map((item) => {
      const amountValue = item.amountCents ? (item.amountCents / 100).toFixed(2) : "";
      const canEdit = Boolean(item.productId || item.priceId);
      const message = item.message
        ? `<p class="price-warning">${escapeHtml(item.message)}</p>`
        : "";

      return `
        <article class="price-card">
          <div>
            <p class="small-note">${escapeHtml(item.planKey)}</p>
            <h3>${escapeHtml(item.planLabel)}</h3>
            <p class="price-value">${escapeHtml(item.amountDisplay || "Ni cene")}</p>
            <p class="small-note">
              ${escapeHtml(item.priceId || "Ni price ID-ja")}
              ${item.source ? ` | ${escapeHtml(item.source)}` : ""}
            </p>
            ${message}
          </div>

          <form class="price-form" data-plan-key="${escapeHtml(item.planKey)}">
            <label>
              Nova cena
              <input name="amount" type="number" min="0.5" step="0.01" value="${escapeHtml(amountValue)}" ${canEdit ? "" : "disabled"} />
            </label>
            <label>
              Valuta
              <input name="currency" type="text" maxlength="3" value="${escapeHtml(item.currency || "eur")}" ${canEdit ? "" : "disabled"} />
            </label>
            <label>
              Interval
              <select name="interval" ${canEdit ? "" : "disabled"}>
                <option value="month" ${item.interval === "month" ? "selected" : ""}>Mesečno</option>
                <option value="year" ${item.interval === "year" ? "selected" : ""}>Letno</option>
              </select>
            </label>
            <label class="check-row">
              <input name="archiveOldPrices" type="checkbox" checked ${canEdit ? "" : "disabled"} />
              <span>Arhiviraj stare aktivne cene</span>
            </label>
            <button type="submit" class="table-action" ${canEdit ? "" : "disabled"}>Shrani novo ceno</button>
          </form>
        </article>
      `;
    })
    .join("");
}

function renderSubscriptions(subscriptions = []) {
  if (!subscriptions.length) {
    subscriptionsBody.innerHTML = '<tr><td colspan="7">Ni Stripe naročnin.</td></tr>';
    return;
  }

  subscriptionsBody.innerHTML = subscriptions
    .map((item) => {
      const customerLabel = item.customer?.email || item.customer?.name || item.customer?.id || "Ni podatka";
      const action = item.cancelAtPeriodEnd
        ? `<button class="table-action" data-action="reactivate" data-id="${escapeHtml(item.id)}">Ponovno aktiviraj</button>`
        : `<button class="table-action danger" data-action="cancel" data-id="${escapeHtml(item.id)}">Ustavi obnovitev</button>`;
      const cancelNotice = item.cancelAtPeriodEnd ? '<span class="small-note">Obnova je ustavljena</span>' : "";

      return `
        <tr>
          <td>
            <span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            ${cancelNotice}
          </td>
          <td>
            <strong>${escapeHtml(item.planLabel)}</strong>
            <span class="small-note">${escapeHtml(item.priceId)}</span>
          </td>
          <td>${escapeHtml(customerLabel)}</td>
          <td>${escapeHtml(item.originUrl || "Ni podatka")}</td>
          <td>${escapeHtml(item.monthlyAmountDisplay)}</td>
          <td>${escapeHtml(formatDate(item.currentPeriodEnd))}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCheckoutSessions(sessions = []) {
  if (!sessions.length) {
    checkoutBody.innerHTML = '<tr><td colspan="6">Ni Stripe checkout aktivnosti.</td></tr>';
    return;
  }

  checkoutBody.innerHTML = sessions
    .map((item) => {
      const email = item.customerEmail || item.customer?.email || item.customer?.id || "Ni podatka";
      return `
        <tr>
          <td>${escapeHtml(formatDate(item.createdAt))}</td>
          <td>
            <span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            <span class="small-note">${escapeHtml(statusLabel(item.paymentStatus))}</span>
          </td>
          <td>${escapeHtml(item.planLabel)}</td>
          <td>${escapeHtml(email)}</td>
          <td>${escapeHtml(item.originUrl || "Ni podatka")}</td>
          <td>${escapeHtml(item.amountTotalDisplay)}</td>
        </tr>
      `;
    })
    .join("");
}

async function adminFetch(path, options = {}) {
  const token = getToken();
  if (!token) {
    throw new Error("Vnesi admin token.");
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Strežnik ni vrnil JSON odgovora.");
  }

  if (!response.ok) {
    throw new Error(data?.error || "Admin zahteva ni uspela.");
  }

  return data;
}

function setLoading(nextLoading) {
  isLoading = nextLoading;
  refreshButton.disabled = isLoading;
  loginForm.querySelector("button[type='submit']").disabled = isLoading;
  document.querySelectorAll(".table-action, .price-form button").forEach((button) => {
    button.disabled = isLoading;
  });
}

async function refreshAdmin() {
  try {
    setLoading(true);
    setFeedback("Osvežujem Stripe podatke ...");
    const overview = await adminFetch("/api/admin/overview");
    sessionStorage.setItem(TOKEN_KEY, getToken());
    renderMetrics(overview.metrics);
    renderPrices(overview.prices);
    renderSubscriptions(overview.subscriptions);
    renderCheckoutSessions(overview.checkoutSessions);
    setFeedback(`Podatki osveženi: ${formatDate(overview.generatedAt)}.`, "success");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Admin osveževanje ni uspelo.", "error");
  } finally {
    setLoading(false);
  }
}

async function updatePrice(form) {
  const planKey = form.getAttribute("data-plan-key");
  const amount = Number(form.elements.amount.value);
  const currency = String(form.elements.currency.value || "eur").trim().toLowerCase();
  const interval = String(form.elements.interval.value || "month");
  const archiveOldPrices = Boolean(form.elements.archiveOldPrices.checked);

  if (!planKey || !Number.isFinite(amount) || amount < 0.5) {
    setFeedback("Vnesi veljavno ceno, najmanj 0,50.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Ustvarim novo Stripe ceno ${amount.toFixed(2)} ${currency.toUpperCase()} za paket ${planKey}?`
  );

  if (!confirmed) {
    return;
  }

  try {
    setLoading(true);
    setFeedback("Ustvarjam novo Stripe ceno ...");
    const result = await adminFetch("/api/admin/prices/create", {
      method: "POST",
      body: JSON.stringify({
        planKey,
        amountCents: Math.round(amount * 100),
        currency,
        interval,
        archiveOldPrices
      })
    });

    const archived = result.archivedCount ? ` Arhiviranih starih cen: ${result.archivedCount}.` : "";
    setFeedback(`Nova cena je ustvarjena.${archived}`, "success");
    await refreshAdmin();
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Urejanje cene ni uspelo.", "error");
    setLoading(false);
  }
}

async function updateRenewal(subscriptionId, action) {
  const isCancel = action === "cancel";
  const confirmed = window.confirm(
    isCancel
      ? "Ustavi obnovitev te naročnine ob koncu trenutnega plačanega obdobja?"
      : "Ponovno aktiviram obnovitev te naročnine?"
  );

  if (!confirmed) {
    return;
  }

  try {
    setLoading(true);
    setFeedback(isCancel ? "Ustavljam obnovitev naročnine ..." : "Ponovno aktiviram obnovitev ...");
    await adminFetch(
      isCancel
        ? "/api/admin/subscriptions/cancel-renewal"
        : "/api/admin/subscriptions/reactivate",
      {
        method: "POST",
        body: JSON.stringify({ subscriptionId })
      }
    );
    await refreshAdmin();
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Sprememba naročnine ni uspela.", "error");
    setLoading(false);
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshAdmin();
});

refreshButton.addEventListener("click", refreshAdmin);

clearTokenButton.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  tokenInput.value = "";
  setFeedback("Token je odstranjen iz te seje.");
});

subscriptionsBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.getAttribute("data-action");
  const subscriptionId = target.getAttribute("data-id");
  if (!action || !subscriptionId) {
    return;
  }

  updateRenewal(subscriptionId, action);
});

priceCards.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!(event.target instanceof HTMLFormElement)) {
    return;
  }

  updatePrice(event.target);
});

const storedToken = sessionStorage.getItem(TOKEN_KEY);
if (storedToken) {
  tokenInput.value = storedToken;
  refreshAdmin();
}
