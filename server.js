import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { analyzeUrl, normalizeUrlInput } from "./src/analyzer.js";
import { createReportPdf } from "./src/report.js";

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(process.cwd(), "public");
const FREE_CRAWL_LIMIT = 5;
const MAX_UNLOCKED_CRAWL_LIMIT = 25;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const STRIPE_PRICE_SINGLE_DOMAIN_ID = process.env.STRIPE_PRICE_SINGLE_DOMAIN_ID || "";
const STRIPE_PRICE_FIVE_DOMAINS_ID = process.env.STRIPE_PRICE_FIVE_DOMAINS_ID || "";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "";
const EMAIL_COPY_TO = "peter@seos.si";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

const CHECKOUT_PLANS = {
  crawl_upgrade: {
    envName: "STRIPE_PRICE_ID",
    feature: "crawl_upgrade",
    key: "crawl_upgrade",
    label: "Premium crawl",
    mode: "payment",
    priceId: STRIPE_PRICE_ID
  },
  single_domain: {
    envName: "STRIPE_PRICE_SINGLE_DOMAIN_ID",
    feature: "domain_monitoring",
    key: "single_domain",
    label: "Single Domain Monitor",
    mode: "subscription",
    priceId: STRIPE_PRICE_SINGLE_DOMAIN_ID
  },
  five_domains: {
    envName: "STRIPE_PRICE_FIVE_DOMAINS_ID",
    feature: "domain_monitoring",
    key: "five_domains",
    label: "Growth Monitor",
    mode: "subscription",
    priceId: STRIPE_PRICE_FIVE_DOMAINS_ID
  }
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function getRequestBearerToken(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
}

function isAdminRequest(request) {
  const providedToken = getRequestBearerToken(request);
  if (!ADMIN_TOKEN || !providedToken) {
    return false;
  }

  const expected = Buffer.from(ADMIN_TOKEN);
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function requireAdmin(request, response) {
  if (!ADMIN_TOKEN) {
    sendJson(response, 503, {
      error: "Admin ni konfiguriran. Nastavite ADMIN_TOKEN v Vercel environment variables."
    });
    return false;
  }

  if (!isAdminRequest(request)) {
    sendJson(response, 401, { error: "Manjka ali je napačen admin token." });
    return false;
  }

  return true;
}

async function callStripe(path, options = {}) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("Stripe ni konfiguriran. Nastavite STRIPE_SECRET_KEY.");
  }

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(options.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {})
    },
    body: options.body
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || "Stripe zahteva ni uspela.";
    throw new Error(message);
  }

  return payload;
}

function getMailer() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    throw new Error("Email ni konfiguriran. Nastavite SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in EMAIL_FROM.");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload je prevelik."));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Neveljaven JSON payload."));
      }
    });
    request.on("error", reject);
  });
}

function buildStripeBody(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body.toString();
}

function getCheckoutPlan(planKey = "crawl_upgrade") {
  const plan = CHECKOUT_PLANS[planKey];
  if (!plan) {
    throw new Error("Izbrani paket ne obstaja.");
  }

  if (!plan.priceId) {
    throw new Error(`Stripe ni konfiguriran za ${plan.label}. Nastavite ${plan.envName}.`);
  }

  return plan;
}

async function createCheckoutSession(originUrl, planKey = "crawl_upgrade") {
  const plan = getCheckoutPlan(planKey);
  const checkoutParams = {
    mode: plan.mode,
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": 1,
    success_url: `${APP_BASE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL}/?checkout=cancelled`,
    "metadata[feature]": plan.feature,
    "metadata[origin_url]": originUrl,
    "metadata[plan]": plan.key,
    "metadata[plan_label]": plan.label
  };

  if (plan.mode === "subscription") {
    checkoutParams["subscription_data[metadata][feature]"] = plan.feature;
    checkoutParams["subscription_data[metadata][origin_url]"] = originUrl;
    checkoutParams["subscription_data[metadata][plan]"] = plan.key;
    checkoutParams["subscription_data[metadata][plan_label]"] = plan.label;
  }

  const session = await callStripe("/v1/checkout/sessions", {
    method: "POST",
    body: buildStripeBody(checkoutParams)
  });

  return { session, plan };
}

async function getCheckoutSession(sessionId) {
  return callStripe(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

function buildStripeListPath(resourcePath, params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
    } else if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `${resourcePath}?${query}` : resourcePath;
}

function getPlanFromPriceId(priceId) {
  const plan = Object.values(CHECKOUT_PLANS).find((item) => item.priceId && item.priceId === priceId);
  return plan || null;
}

function getPlanCapacity(planKey) {
  if (planKey === "single_domain") {
    return 1;
  }

  if (planKey === "five_domains") {
    return 5;
  }

  return 0;
}

function formatMoney(cents, currency = "eur") {
  if (!Number.isFinite(cents)) {
    return "";
  }

  return new Intl.NumberFormat("sl-SI", {
    style: "currency",
    currency: String(currency || "eur").toUpperCase()
  }).format(cents / 100);
}

function toIsoDate(stripeTimestamp) {
  return stripeTimestamp ? new Date(stripeTimestamp * 1000).toISOString() : null;
}

function getCustomerSummary(customer) {
  if (!customer || typeof customer !== "object") {
    return {
      id: typeof customer === "string" ? customer : "",
      email: "",
      name: ""
    };
  }

  return {
    id: customer.id || "",
    email: customer.email || "",
    name: customer.name || ""
  };
}

function getMonthlyAmountCents(subscription) {
  const items = subscription.items?.data || [];
  return Math.round(items.reduce((total, item) => {
    const price = item.price || {};
    const recurring = price.recurring || {};
    const quantity = Number(item.quantity || 1);
    const amount = Number(price.unit_amount || 0) * quantity;
    const intervalCount = Number(recurring.interval_count || 1);

    if (!amount || !recurring.interval || !intervalCount) {
      return total;
    }

    if (recurring.interval === "year") {
      return total + amount / (12 * intervalCount);
    }

    if (recurring.interval === "week") {
      return total + (amount * 52) / (12 * intervalCount);
    }

    if (recurring.interval === "day") {
      return total + (amount * 365) / (12 * intervalCount);
    }

    return total + amount / intervalCount;
  }, 0));
}

function summarizeSubscription(subscription) {
  const firstItem = subscription.items?.data?.[0] || {};
  const price = firstItem.price || {};
  const pricePlan = getPlanFromPriceId(price.id);
  const planKey = subscription.metadata?.plan || pricePlan?.key || "";
  const planLabel =
    subscription.metadata?.plan_label ||
    pricePlan?.label ||
    price.nickname ||
    "Stripe naročnina";
  const customer = getCustomerSummary(subscription.customer);
  const monthlyAmountCents = getMonthlyAmountCents(subscription);

  return {
    id: subscription.id,
    status: subscription.status,
    planKey,
    planLabel,
    originUrl: subscription.metadata?.origin_url || "",
    customer,
    priceId: price.id || "",
    currency: price.currency || "eur",
    monthlyAmountCents,
    monthlyAmountDisplay: formatMoney(monthlyAmountCents, price.currency || "eur"),
    createdAt: toIsoDate(subscription.created),
    currentPeriodEnd: toIsoDate(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toIsoDate(subscription.canceled_at),
    domainCapacity: getPlanCapacity(planKey)
  };
}

function summarizeCheckoutSession(session) {
  const customer = getCustomerSummary(session.customer);
  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    planKey: session.metadata?.plan || "",
    planLabel: session.metadata?.plan_label || "Stripe checkout",
    originUrl: session.metadata?.origin_url || "",
    customer,
    customerEmail: session.customer_details?.email || customer.email || "",
    amountTotalCents: Number(session.amount_total || 0),
    amountTotalDisplay: formatMoney(Number(session.amount_total || 0), session.currency || "eur"),
    currency: session.currency || "eur",
    createdAt: toIsoDate(session.created)
  };
}

async function listStripeSubscriptions() {
  return callStripe(buildStripeListPath("/v1/subscriptions", {
    limit: 100,
    status: "all",
    "expand[]": ["data.customer"]
  }));
}

async function listStripeCheckoutSessions() {
  return callStripe(buildStripeListPath("/v1/checkout/sessions", {
    limit: 50,
    "expand[]": ["data.customer"]
  }));
}

function buildAdminMetrics(subscriptions, checkoutSessions) {
  const activeStatuses = new Set(["active", "trialing"]);
  const activeSubscriptions = subscriptions.filter((item) => activeStatuses.has(item.status));
  const problemSubscriptions = subscriptions.filter((item) => ["past_due", "unpaid", "incomplete"].includes(item.status));
  const cancelingSubscriptions = subscriptions.filter((item) => item.cancelAtPeriodEnd);
  const completedCheckoutSessions = checkoutSessions.filter((item) => item.status === "complete");
  const openCheckoutSessions = checkoutSessions.filter((item) => item.status === "open");
  const mrrCents = activeSubscriptions.reduce((total, item) => total + item.monthlyAmountCents, 0);
  const domainCapacity = activeSubscriptions.reduce((total, item) => total + item.domainCapacity, 0);

  return {
    totalSubscriptions: subscriptions.length,
    activeSubscriptions: activeSubscriptions.length,
    problemSubscriptions: problemSubscriptions.length,
    cancelingSubscriptions: cancelingSubscriptions.length,
    completedCheckoutSessions: completedCheckoutSessions.length,
    openCheckoutSessions: openCheckoutSessions.length,
    estimatedDomainCapacity: domainCapacity,
    estimatedMrrCents: mrrCents,
    estimatedMrrDisplay: formatMoney(mrrCents, activeSubscriptions[0]?.currency || "eur")
  };
}

async function getAdminOverview() {
  const [subscriptionsPayload, checkoutSessionsPayload] = await Promise.all([
    listStripeSubscriptions(),
    listStripeCheckoutSessions()
  ]);

  const subscriptions = (subscriptionsPayload.data || []).map(summarizeSubscription);
  const checkoutSessions = (checkoutSessionsPayload.data || []).map(summarizeCheckoutSession);

  return {
    generatedAt: new Date().toISOString(),
    source: "stripe",
    metrics: buildAdminMetrics(subscriptions, checkoutSessions),
    subscriptions,
    checkoutSessions
  };
}

async function updateSubscriptionRenewal(subscriptionId, cancelAtPeriodEnd) {
  return callStripe(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    body: buildStripeBody({
      cancel_at_period_end: cancelAtPeriodEnd ? "true" : "false"
    })
  });
}

function extractLinks(html, baseUrl) {
  const links = [...html.matchAll(/<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return [...new Set(links)];
}

async function discoverUrls(seedUrl, limit = 6) {
  const normalized = new URL(normalizeUrlInput(seedUrl));
  const discovered = new Set([normalized.toString()]);
  const sitemapUrl = new URL("/sitemap.xml", normalized.origin);

  try {
    const sitemapResponse = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GPTIndexReadinessChecker/1.0)"
      }
    });
    if (sitemapResponse.ok) {
      const sitemapXml = await sitemapResponse.text();
      const sitemapLinks = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/gi)]
        .map((match) => match[1].trim())
        .filter((url) => {
          try {
            const candidate = new URL(url);
            return candidate.origin === normalized.origin;
          } catch {
            return false;
          }
        });

      for (const link of sitemapLinks) {
        if (discovered.size >= limit) {
          break;
        }
        discovered.add(link);
      }
    }
  } catch {
    // Ignore sitemap issues and fallback to homepage links.
  }

  if (discovered.size < limit) {
    try {
      const homepageResponse = await fetch(normalized, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GPTIndexReadinessChecker/1.0)"
        }
      });
      if (homepageResponse.ok) {
        const homepageHtml = await homepageResponse.text();
        const homepageLinks = extractLinks(homepageHtml, normalized);
        for (const link of homepageLinks) {
          const candidate = new URL(link);
          if (candidate.origin !== normalized.origin) {
            continue;
          }
          if (candidate.pathname.match(/\.(jpg|jpeg|png|gif|pdf|svg|zip|webp)$/i)) {
            continue;
          }
          discovered.add(candidate.toString());
          if (discovered.size >= limit) {
            break;
          }
        }
      }
    } catch {
      // Ignore homepage crawl issues.
    }
  }

  return [...discovered].slice(0, limit);
}

function sanitizePath(requestPath) {
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(PUBLIC_DIR, safePath === "\\" || safePath === "/" ? "index.html" : safePath);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API pot ni bila najdena." });
    return;
  }

  let filePath = url.pathname === "/admin"
    ? join(PUBLIC_DIR, "admin.html")
    : sanitizePath(url.pathname);

  if (!extname(filePath)) {
    filePath = join(filePath, "index.html");
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream"
    });
    response.end(file);
  } catch (error) {
    try {
      const fallback = await readFile(join(PUBLIC_DIR, "index.html"));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fallback);
    } catch {
      sendJson(response, 404, { error: "Datoteka ni bila najdena." });
    }
  }
}

export async function handleRequest(request, response) {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Manjka URL zahteve." });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS, POST",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/analyze" && request.method === "GET") {
      const target = url.searchParams.get("url");
      const profile = url.searchParams.get("profile") || "general";

      if (!target) {
        sendJson(response, 400, { error: "Vnesite URL spletne strani." });
        return;
      }

      try {
        const result = await analyzeUrl(target, profile);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Analiza ni uspela."
        });
        return;
      }
      return;
    }

    if (url.pathname === "/api/crawl" && request.method === "GET") {
      const target = url.searchParams.get("url");
      const profile = url.searchParams.get("profile") || "general";
      const requestedLimit = Math.min(Number(url.searchParams.get("limit") || FREE_CRAWL_LIMIT), MAX_UNLOCKED_CRAWL_LIMIT);
      const checkoutSessionId = url.searchParams.get("checkoutSessionId");

      if (!target) {
        sendJson(response, 400, { error: "Vnesite začetni URL za crawl." });
        return;
      }

      try {
        let allowedLimit = FREE_CRAWL_LIMIT;

        if (requestedLimit > FREE_CRAWL_LIMIT) {
          if (!checkoutSessionId) {
            sendJson(response, 402, {
              error: "Brezplačni crawl omogoča do 5 strani.",
              requiresUpgrade: true,
              freeLimit: FREE_CRAWL_LIMIT
            });
            return;
          }

          const session = await getCheckoutSession(checkoutSessionId);
          const isPaidUpgrade =
            session.payment_status === "paid" &&
            session.metadata?.feature === "crawl_upgrade";

          if (!isPaidUpgrade) {
            sendJson(response, 402, {
              error: "Plačilo za dodatne strani ni bilo potrjeno.",
              requiresUpgrade: true,
              freeLimit: FREE_CRAWL_LIMIT
            });
            return;
          }

          allowedLimit = MAX_UNLOCKED_CRAWL_LIMIT;
        }

        const finalLimit = Math.min(requestedLimit, allowedLimit);
        const urls = await discoverUrls(target, finalLimit);
        const results = await Promise.all(urls.map((entry) => analyzeUrl(entry, profile)));
        results.sort((a, b) => b.score - a.score);

        sendJson(response, 200, {
          seedUrl: normalizeUrlInput(target),
          profile,
          freeLimit: FREE_CRAWL_LIMIT,
          requestedLimit,
          allowedLimit: finalLimit,
          crawledCount: results.length,
          urls,
          results
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Crawl ni uspel."
        });
        return;
      }
      return;
    }

    if (url.pathname === "/api/checkout-session" && request.method === "GET") {
      const target = url.searchParams.get("url");
      const plan = url.searchParams.get("plan") || "crawl_upgrade";

      if (!target) {
        sendJson(response, 400, { error: "Za checkout je potreben začetni URL." });
        return;
      }

      try {
        const { session, plan: checkoutPlan } = await createCheckoutSession(target, plan);
        sendJson(response, 200, {
          checkoutUrl: session.url,
          sessionId: session.id,
          plan: checkoutPlan.key,
          planLabel: checkoutPlan.label
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Stripe checkout ni uspel."
        });
        return;
      }
      return;
    }

    if (url.pathname === "/api/checkout-session-status" && request.method === "GET") {
      const sessionId = url.searchParams.get("session_id");

      if (!sessionId) {
        sendJson(response, 400, { error: "Manjka session_id." });
        return;
      }

      try {
        const session = await getCheckoutSession(sessionId);
        sendJson(response, 200, {
          sessionId: session.id,
          paymentStatus: session.payment_status,
          status: session.status,
          feature: session.metadata?.feature || "",
          plan: session.metadata?.plan || "",
          planLabel: session.metadata?.plan_label || "",
          isCheckoutComplete:
            session.status === "complete" || session.payment_status === "paid",
          isUpgradePaid:
            session.payment_status === "paid" && session.metadata?.feature === "crawl_upgrade"
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Preverjanje Stripe seje ni uspelo."
        });
        return;
      }
      return;
    }

    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      if (!requireAdmin(request, response)) {
        return;
      }

      try {
        const overview = await getAdminOverview();
        sendJson(response, 200, overview);
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Admin pregled ni uspel."
        });
      }
      return;
    }

    if (url.pathname === "/api/admin/subscriptions/cancel-renewal" && request.method === "POST") {
      if (!requireAdmin(request, response)) {
        return;
      }

      try {
        const payload = await readJsonBody(request);
        const subscriptionId = String(payload.subscriptionId || "").trim();

        if (!subscriptionId || !subscriptionId.startsWith("sub_")) {
          sendJson(response, 400, { error: "Manjka veljaven Stripe subscription ID." });
          return;
        }

        const subscription = await updateSubscriptionRenewal(subscriptionId, true);
        sendJson(response, 200, {
          success: true,
          subscription: summarizeSubscription(subscription)
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Preklic obnove naročnine ni uspel."
        });
      }
      return;
    }

    if (url.pathname === "/api/admin/subscriptions/reactivate" && request.method === "POST") {
      if (!requireAdmin(request, response)) {
        return;
      }

      try {
        const payload = await readJsonBody(request);
        const subscriptionId = String(payload.subscriptionId || "").trim();

        if (!subscriptionId || !subscriptionId.startsWith("sub_")) {
          sendJson(response, 400, { error: "Manjka veljaven Stripe subscription ID." });
          return;
        }

        const subscription = await updateSubscriptionRenewal(subscriptionId, false);
        sendJson(response, 200, {
          success: true,
          subscription: summarizeSubscription(subscription)
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Ponovna aktivacija obnove ni uspela."
        });
      }
      return;
    }

    if (url.pathname === "/api/email-report" && request.method === "POST") {
      try {
        const payload = await readJsonBody(request);
        const email = String(payload.email || "").trim();
        const results = Array.isArray(payload.results) ? payload.results : [];
        const mode = payload.mode === "crawl" ? "crawl" : "analyze";
        const profileLabel = String(payload.profileLabel || "Splošna stran");

        if (!email) {
          sendJson(response, 400, { error: "Vnesite email naslov." });
          return;
        }

        if (!results.length) {
          sendJson(response, 400, { error: "Ni rezultatov za pošiljanje." });
          return;
        }

        const pdfBuffer = await createReportPdf({
          mode,
          profileLabel,
          results
        });

        const mailer = getMailer();
        await mailer.sendMail({
          from: EMAIL_FROM,
          to: email,
          cc: EMAIL_COPY_TO,
          subject: "Vaše AI readiness poročilo",
          text: [
            "Pozdravljeni,",
            "",
            "v priponki pošiljamo PDF poročilo analize vaše spletne strani.",
            "V poročilu so zbrani ključni AI in tehnični kriteriji, skupna ocena ter priporočila za izboljšave.",
            "",
            "Lep pozdrav,",
            "SEOS group d.o.o."
          ].join("\n"),
          html: [
            "<p>Pozdravljeni,</p>",
            "<p>v priponki pošiljamo PDF poročilo analize vaše spletne strani.</p>",
            "<p>V poročilu so zbrani ključni AI in tehnični kriteriji, skupna ocena ter priporočila za izboljšave.</p>",
            "<p>Lep pozdrav,<br />SEOS group d.o.o.</p>"
          ].join(""),
          attachments: [
            {
              filename: "chatgpt-readiness-report.pdf",
              content: pdfBuffer,
              contentType: "application/pdf"
            }
          ]
        });

        sendJson(response, 200, {
          success: true,
          sentTo: email,
          copiedTo: EMAIL_COPY_TO
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Posiljanje emaila ni uspelo."
        });
        return;
      }
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    const isApiRequest = Boolean(request.url?.startsWith("/api/"));
    if (isApiRequest) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Nepričakovana napaka pri API obdelavi."
      });
      return;
    }

    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Server error");
  }
}

export function createAppServer() {
  return createServer(handleRequest);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`GPT readiness checker running at http://localhost:${PORT}`);
  });
}
