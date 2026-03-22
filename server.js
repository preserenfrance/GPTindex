import { createServer } from "node:http";
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
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "";
const EMAIL_COPY_TO = "peter@seos.si";

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
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

async function createCheckoutSession(originUrl) {
  if (!STRIPE_PRICE_ID) {
    throw new Error("Stripe ni konfiguriran. Nastavite STRIPE_PRICE_ID.");
  }

  return callStripe("/v1/checkout/sessions", {
    method: "POST",
    body: buildStripeBody({
      mode: "payment",
      "line_items[0][price]": STRIPE_PRICE_ID,
      "line_items[0][quantity]": 1,
      success_url: `${APP_BASE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/?checkout=cancelled`,
      "metadata[feature]": "crawl_upgrade",
      "metadata[origin_url]": originUrl
    })
  });
}

async function getCheckoutSession(sessionId) {
  return callStripe(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
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

  let filePath = sanitizePath(url.pathname);

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

export function createAppServer() {
  return createServer(async (request, response) => {
    try {
      if (!request.url) {
        sendJson(response, 400, { error: "Manjka URL zahteve." });
        return;
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
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
        }
        return;
      }

      if (url.pathname === "/api/checkout-session" && request.method === "GET") {
        const target = url.searchParams.get("url");

        if (!target) {
          sendJson(response, 400, { error: "Za checkout je potreben začetni URL." });
          return;
        }

        try {
          const session = await createCheckoutSession(target);
          sendJson(response, 200, {
            checkoutUrl: session.url,
            sessionId: session.id
          });
        } catch (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "Stripe checkout ni uspel."
          });
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
            isUpgradePaid:
              session.payment_status === "paid" && session.metadata?.feature === "crawl_upgrade"
          });
        } catch (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "Preverjanje Stripe seje ni uspelo."
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
            subject: "ChatGPT readiness report",
            text: "V priponki posiljam PDF porocilo analize spletne strani. Kopija je bila poslana tudi na peter@seos.si.",
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
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`GPT readiness checker running at http://localhost:${PORT}`);
  });
}
