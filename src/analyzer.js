const USER_AGENTS = ["ChatGPT-User", "OAI-SearchBot", "GPTBot"];
const PAGE_PROFILES = ["general", "blog", "shop", "landing"];

const RULES = [
  { id: "https", label: "Varna HTTPS dostopnost", weight: 8 },
  { id: "robots", label: "robots.txt omogoča AI/iskalni dostop", weight: 18 },
  { id: "fetch", label: "Stran je tehnično dosegljiva", weight: 10 },
  { id: "indexability", label: "Stran ni označena kot noindex/nosnippet", weight: 14 },
  { id: "title", label: "Stran ima jasen naslov", weight: 8 },
  { id: "description", label: "Stran ima meta description", weight: 6 },
  { id: "canonical", label: "Canonical URL je definiran", weight: 5 },
  { id: "lang", label: "Jezik vsebine je označen", weight: 5 },
  { id: "structuredData", label: "Prisotni so strukturirani podatki", weight: 8 },
  { id: "contentDepth", label: "Na strani je dovolj berljive vsebine", weight: 10 },
  { id: "semanticStructure", label: "Vsebina je semantično strukturirana", weight: 4 },
  { id: "sitemap", label: "Na voljo je sitemap", weight: 4 }
];

const PROFILE_CONFIG = {
  general: {
    label: "Splošna stran",
    checks: []
  },
  blog: {
    label: "Blog / članek",
    checks: [
      {
        id: "blogArticle",
        label: "Članek ima člankarsko strukturo",
        weight: 8,
        passed: (metrics) => metrics.articleSignals.articleTagCount > 0 || metrics.articleSignals.blogSchemaCount > 0,
        details: (metrics) =>
          metrics.articleSignals.articleTagCount > 0 || metrics.articleSignals.blogSchemaCount > 0
            ? "Najden je article element ali Article schema."
            : "Article struktura ni bila zaznana.",
        recommendation: "Za blog vsebine uporabite <article> in/ali schema.org Article."
      },
      {
        id: "blogAuthor",
        label: "Avtor je jasno naveden",
        weight: 6,
        passed: (metrics) => metrics.articleSignals.authorSignals > 0,
        details: (metrics) =>
          metrics.articleSignals.authorSignals > 0 ? "Prisoten je signal avtorja." : "Signal avtorja ni bil najden.",
        recommendation: "Dodajte avtorja članka v vidno vsebino ali meta/schema podatke."
      },
      {
        id: "blogFreshness",
        label: "Datum objave ali posodobitve je naveden",
        weight: 6,
        passed: (metrics) => metrics.articleSignals.dateSignals > 0,
        details: (metrics) =>
          metrics.articleSignals.dateSignals > 0 ? "Prisoten je datum objave ali posodobitve." : "Datum ni bil zaznan.",
        recommendation: "Dodajte datum objave oziroma posodobitve, da je svežina vsebine jasna."
      }
    ]
  },
  shop: {
    label: "Trgovina / produktna stran",
    checks: [
      {
        id: "shopProductSchema",
        label: "Produktna schema je prisotna",
        weight: 8,
        passed: (metrics) => metrics.commerceSignals.productSchemaCount > 0,
        details: (metrics) =>
          metrics.commerceSignals.productSchemaCount > 0
            ? "Najden je Product schema signal."
            : "Product schema ni bila najdena.",
        recommendation: "Dodajte schema.org Product podatke za lažje razumevanje produktne strani."
      },
      {
        id: "shopPrice",
        label: "Cena je jasno navedena",
        weight: 7,
        passed: (metrics) => metrics.commerceSignals.priceSignals > 0,
        details: (metrics) =>
          metrics.commerceSignals.priceSignals > 0 ? "Cena je bila zaznana." : "Cena ni bila zaznana.",
        recommendation: "Na produktni strani jasno izpišite ceno in po možnosti valuto."
      },
      {
        id: "shopAvailability",
        label: "Zaloga ali dobavljivost je označena",
        weight: 5,
        passed: (metrics) => metrics.commerceSignals.availabilitySignals > 0,
        details: (metrics) =>
          metrics.commerceSignals.availabilitySignals > 0
            ? "Signal dobavljivosti je prisoten."
            : "Signal dobavljivosti ni bil zaznan.",
        recommendation: "Dodajte informacijo o zalogi oziroma dobavljivosti."
      }
    ]
  },
  landing: {
    label: "Landing page",
    checks: [
      {
        id: "landingHero",
        label: "Glavno sporočilo je jasno izpostavljeno",
        weight: 8,
        passed: (metrics) => metrics.landingSignals.h1Count >= 1 && metrics.title.length >= 15,
        details: (metrics) =>
          metrics.landingSignals.h1Count >= 1
            ? "Prisoten je H1 in dovolj jasen naslov."
            : "H1 naslov ni bil zaznan.",
        recommendation: "Dodajte jasen H1, ki pove vrednost ponudbe že v prvem zaslonu."
      },
      {
        id: "landingCta",
        label: "Prisoten je jasen CTA",
        weight: 7,
        passed: (metrics) => metrics.landingSignals.ctaSignals > 0,
        details: (metrics) =>
          metrics.landingSignals.ctaSignals > 0 ? "CTA element je bil zaznan." : "CTA element ni bil zaznan.",
        recommendation: "Dodajte izrazit CTA gumb ali obrazec, npr. rezervacija, kontakt ali prijava."
      },
      {
        id: "landingTrust",
        label: "Prisotni so trust signali ali FAQ",
        weight: 5,
        passed: (metrics) => metrics.landingSignals.trustSignals > 0 || metrics.landingSignals.faqSchemaCount > 0,
        details: (metrics) =>
          metrics.landingSignals.trustSignals > 0 || metrics.landingSignals.faqSchemaCount > 0
            ? "Prisotni so trust signali ali FAQ schema."
            : "Trust signalov ali FAQ sheme ni bilo zaznati.",
        recommendation: "Dodajte reference, ocene, FAQ ali druge trust signale."
      }
    ]
  }
};

function normalizeTarget(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL je prazen.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Podprt je samo http ali https URL.");
  }

  return url;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GPTIndexReadinessChecker/1.0)"
    },
    ...options
  });

  const text = await response.text();
  return { response, text };
}

function extractTagContent(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return html.match(regex)?.[1]?.trim() ?? "";
}

function extractMetaContent(html, attrName, attrValue) {
  const regex = new RegExp(
    `<meta[^>]*${attrName}=["']${attrValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const reverseRegex = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${attrValue}["'][^>]*>`,
    "i"
  );

  return html.match(regex)?.[1]?.trim() ?? html.match(reverseRegex)?.[1]?.trim() ?? "";
}

function extractLinkHref(html, relValue) {
  const regex = new RegExp(
    `<link[^>]*rel=["'][^"']*${relValue}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const reverseRegex = new RegExp(
    `<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*${relValue}[^"']*["'][^>]*>`,
    "i"
  );

  return html.match(regex)?.[1]?.trim() ?? html.match(reverseRegex)?.[1]?.trim() ?? "";
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(html, regex) {
  return (html.match(regex) || []).length;
}

function parseRobots(robotsText, pathName) {
  const lines = robotsText
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean);

  const groups = [];
  let current = null;

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      current = { userAgents: [value.toLowerCase()], allow: [], disallow: [], sitemap: [] };
      groups.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "allow") {
      current.allow.push(value);
    } else if (key === "disallow") {
      current.disallow.push(value);
    } else if (key === "sitemap") {
      current.sitemap.push(value);
    }
  }

  const findGroup = (agent) =>
    groups.find((group) => group.userAgents.includes(agent.toLowerCase())) ||
    groups.find((group) => group.userAgents.includes("*"));

  const matchedGroups = USER_AGENTS.map((agent) => ({ agent, group: findGroup(agent) }));

  const matchesPath = (rulePath) => {
    if (!rulePath) {
      return false;
    }
    if (rulePath === "/") {
      return true;
    }
    return pathName.startsWith(rulePath);
  };

  const blockedAgents = matchedGroups
    .filter(({ group }) => group && group.disallow.some(matchesPath))
    .map(({ agent }) => agent);

  const allowedAgents = matchedGroups
    .filter(({ group }) => !group || !group.disallow.some(matchesPath) || group.allow.some(matchesPath))
    .map(({ agent }) => agent);

  const sitemaps = [...new Set(groups.flatMap((group) => group.sitemap))];

  return {
    blockedAgents,
    allowedAgents,
    sitemaps
  };
}

function summarizeScore(score) {
  if (score >= 85) {
    return { label: "Odlično pripravljena", tone: "strong" };
  }
  if (score >= 70) {
    return { label: "Dobro pripravljena", tone: "good" };
  }
  if (score >= 50) {
    return { label: "Delno pripravljena", tone: "medium" };
  }
  return { label: "Slabo pripravljena", tone: "weak" };
}

function buildRecommendation(results) {
  return results
    .filter((item) => !item.passed)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((item) => item.recommendation);
}

function countKeywordMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0);
}

function evaluateRules(metrics) {
  return RULES.map((rule) => {
    switch (rule.id) {
      case "https":
        return {
          ...rule,
          passed: metrics.protocol === "https:",
          details: metrics.protocol === "https:" ? "Stran uporablja HTTPS." : "Stran ne uporablja HTTPS.",
          recommendation: "Omogočite HTTPS, ker varna dostopnost povečuje zaupanje in stabilnost pregledovanja."
        };
      case "robots":
        return {
          ...rule,
          passed: metrics.blockedAgents.length === 0,
          details:
            metrics.blockedAgents.length === 0
              ? "robots.txt ne blokira ključnih AI/iskalnih agentov."
              : `Blokirani agenti: ${metrics.blockedAgents.join(", ")}.`,
          recommendation:
            "Preverite robots.txt in odstranite blokade za ChatGPT-User, OAI-SearchBot ali GPTBot, če želite, da je vsebina dosegljiva."
        };
      case "fetch":
        return {
          ...rule,
          passed: metrics.httpOk,
          details: `HTTP status: ${metrics.status}.`,
          recommendation: "Poskrbite, da stran vrača uspešen status 200 in ni odvisna od blokirajočih preusmeritev ali napak."
        };
      case "indexability":
        return {
          ...rule,
          passed: !metrics.metaRobotsFlags.some((flag) => ["noindex", "nosnippet", "none"].includes(flag)),
          details:
            metrics.metaRobotsFlags.length > 0
              ? `Meta robots: ${metrics.metaRobotsFlags.join(", ")}.`
              : "Ni problematičnih meta robots oznak.",
          recommendation: "Odstranite noindex, nosnippet ali none, če želite omogočiti povzemanje in indeksacijo vsebine."
        };
      case "title":
        return {
          ...rule,
          passed: metrics.title.length >= 15,
          details: metrics.title ? `Naslov: "${metrics.title}".` : "Manjka <title>.",
          recommendation: "Dodajte jasen, specifičen naslov strani, ki povzema glavno temo."
        };
      case "description":
        return {
          ...rule,
          passed: metrics.description.length >= 50,
          details: metrics.description ? "Meta description je prisoten." : "Meta description manjka.",
          recommendation: "Dodajte uporaben meta description, da bo tema strani lažje razumljiva."
        };
      case "canonical":
        return {
          ...rule,
          passed: Boolean(metrics.canonical),
          details: metrics.canonical ? `Canonical: ${metrics.canonical}.` : "Canonical povezava manjka.",
          recommendation: "Dodajte canonical URL, da bo izvorna verzija vsebine jasna."
        };
      case "lang":
        return {
          ...rule,
          passed: Boolean(metrics.lang),
          details: metrics.lang ? `HTML lang: ${metrics.lang}.` : "Atribut lang manjka.",
          recommendation: "Dodajte atribut lang na <html>, da je jezik vsebine nedvoumen."
        };
      case "structuredData":
        return {
          ...rule,
          passed: metrics.structuredDataCount > 0,
          details:
            metrics.structuredDataCount > 0
              ? `Najdenih script[type="application/ld+json"]: ${metrics.structuredDataCount}.`
              : "Strukturirani podatki niso bili najdeni.",
          recommendation: "Dodajte schema.org strukturirane podatke za članke, organizacijo, FAQ ali produkte."
        };
      case "contentDepth":
        return {
          ...rule,
          passed: metrics.wordCount >= 300,
          details: `Ocenjeno število besed: ${metrics.wordCount}.`,
          recommendation: "Dodajte več jasne, izvirne besedilne vsebine; zelo kratke strani so težje za kakovostno povzemanje."
        };
      case "semanticStructure":
        return {
          ...rule,
          passed: metrics.headingCount >= 3 && metrics.paragraphCount >= 3,
          details: `Naslovi: ${metrics.headingCount}, odstavki: ${metrics.paragraphCount}.`,
          recommendation: "Uporabite H1/H2/H3 naslove in razdelite vsebino v smiselne odstavke."
        };
      case "sitemap":
        return {
          ...rule,
          passed: metrics.sitemapAvailable,
          details: metrics.sitemapAvailable ? "Sitemap je na voljo." : "Sitemap ni bil najden.",
          recommendation: "Objavite sitemap.xml in ga navedite tudi v robots.txt."
        };
      default:
        return {
          ...rule,
          passed: false,
          details: "Pravilo ni bilo obdelano.",
          recommendation: "Preverite konfiguracijo."
        };
    }
  });
}

function evaluateProfile(profile, metrics) {
  const selectedProfile = PROFILE_CONFIG[profile] ? profile : "general";
  const profileChecks = PROFILE_CONFIG[selectedProfile].checks.map((check) => ({
    id: check.id,
    label: check.label,
    weight: check.weight,
    passed: check.passed(metrics),
    details: check.details(metrics),
    recommendation: check.recommendation
  }));

  return {
    profile: selectedProfile,
    label: PROFILE_CONFIG[selectedProfile].label,
    checks: profileChecks
  };
}

export async function analyzeUrl(targetUrl, profile = "general") {
  const normalizedUrl = normalizeTarget(targetUrl);
  const robotsUrl = new URL("/robots.txt", normalizedUrl.origin);
  const defaultSitemapUrl = new URL("/sitemap.xml", normalizedUrl.origin);

  const pageResult = await fetchText(normalizedUrl.toString());
  const pageHtml = pageResult.text;

  let robotsText = "";
  let robotsStatus = null;
  try {
    const robotsResult = await fetchText(robotsUrl.toString());
    robotsStatus = robotsResult.response.status;
    if (robotsResult.response.ok) {
      robotsText = robotsResult.text;
    }
  } catch {
    robotsStatus = null;
  }

  const robotsInfo = parseRobots(robotsText, normalizedUrl.pathname);

  let sitemapAvailable = false;
  const sitemapCandidates = robotsInfo.sitemaps.length > 0 ? robotsInfo.sitemaps : [defaultSitemapUrl.toString()];
  for (const candidate of sitemapCandidates) {
    try {
      const response = await fetch(candidate, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GPTIndexReadinessChecker/1.0)"
        }
      });
      if (response.ok) {
        sitemapAvailable = true;
        break;
      }
    } catch {
      continue;
    }
  }

  const textContent = stripHtml(pageHtml);
  const words = textContent ? textContent.split(/\s+/).filter(Boolean) : [];
  const title = extractTagContent(pageHtml, "title");
  const description = extractMetaContent(pageHtml, "name", "description");
  const metaRobots = extractMetaContent(pageHtml, "name", "robots").toLowerCase();
  const metaRobotsFlags = metaRobots.split(",").map((flag) => flag.trim()).filter(Boolean);
  const canonical = extractLinkHref(pageHtml, "canonical");
  const htmlTagMatch = pageHtml.match(/<html[^>]*lang=["']([^"']+)["']/i);
  const lang = htmlTagMatch?.[1]?.trim() ?? "";
  const structuredDataCount = countMatches(pageHtml, /<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
  const headingCount = countMatches(pageHtml, /<h[1-3][^>]*>/gi);
  const paragraphCount = countMatches(pageHtml, /<p[^>]*>/gi);
  const h1Count = countMatches(pageHtml, /<h1[^>]*>/gi);
  const articleTagCount = countMatches(pageHtml, /<article[^>]*>/gi);
  const blogSchemaCount = countMatches(pageHtml, /"@type"\s*:\s*"(Article|BlogPosting|NewsArticle)"/gi);
  const productSchemaCount = countMatches(pageHtml, /"@type"\s*:\s*"Product"/gi);
  const faqSchemaCount = countMatches(pageHtml, /"@type"\s*:\s*"FAQPage"/gi);
  const authorSignals =
    countMatches(pageHtml, /rel=["']author["']/gi) +
    countMatches(pageHtml, /meta[^>]+name=["']author["']/gi) +
    countKeywordMatches(textContent, ["author", "avtor", "written by"]);
  const dateSignals =
    countMatches(pageHtml, /datetime=["'][^"']+["']/gi) +
    countMatches(pageHtml, /meta[^>]+property=["']article:published_time["']/gi) +
    countMatches(pageHtml, /meta[^>]+property=["']article:modified_time["']/gi);
  const priceSignals =
    countMatches(textContent, /€\s?\d|\$\s?\d|\d[\d.,]*\s?(eur|usd|€|\$)/gi) +
    countMatches(pageHtml, /"price"\s*:/gi);
  const availabilitySignals =
    countKeywordMatches(textContent, ["in stock", "out of stock", "na zalogi", "dobavljivo", "available"]) +
    countMatches(pageHtml, /"availability"\s*:/gi);
  const ctaSignals =
    countMatches(pageHtml, /<(button|a)[^>]*>([\s\S]*?)(buy|book|contact|get started|start|request|signup|sign up|trial|quote|kontakt|rezerviraj|prijava|naroči|kupite|preizkusi)/gi) +
    countMatches(pageHtml, /<form[^>]*>/gi);
  const trustSignals = countKeywordMatches(textContent, [
    "testimonial",
    "review",
    "mnenje",
    "ocena",
    "trusted by",
    "stranka",
    "case study"
  ]);

  const metrics = {
    protocol: normalizedUrl.protocol,
    httpOk: pageResult.response.ok,
    status: pageResult.response.status,
    blockedAgents: robotsInfo.blockedAgents,
    title,
    description,
    canonical,
    lang,
    structuredDataCount,
    wordCount: words.length,
    headingCount,
    paragraphCount,
    sitemapAvailable,
    metaRobotsFlags,
    articleSignals: {
      articleTagCount,
      blogSchemaCount,
      authorSignals,
      dateSignals
    },
    commerceSignals: {
      productSchemaCount,
      priceSignals,
      availabilitySignals
    },
    landingSignals: {
      h1Count,
      ctaSignals,
      trustSignals,
      faqSchemaCount
    }
  };

  const baseChecks = evaluateRules(metrics);
  const profileResult = evaluateProfile(profile, metrics);
  const allChecks = [...baseChecks, ...profileResult.checks];
  const maxScore = allChecks.reduce((sum, rule) => sum + rule.weight, 0);
  const score = Math.round(
    (allChecks.reduce((sum, rule) => sum + (rule.passed ? rule.weight : 0), 0) / maxScore) * 100
  );
  const verdict = summarizeScore(score);

  return {
    url: normalizedUrl.toString(),
    fetchedAt: new Date().toISOString(),
    profile: profileResult.profile,
    profileLabel: profileResult.label,
    score,
    verdict,
    summary: {
      title: title || normalizedUrl.hostname,
      description:
        verdict.label === "Odlično pripravljena"
          ? "Stran je tehnično in vsebinsko dobro pripravljena za pregledovanje in povzemanje."
          : verdict.label === "Dobro pripravljena"
            ? "Osnova je dobra, nekaj izboljšav pa lahko še poveča zanesljivost in razumljivost."
            : verdict.label === "Delno pripravljena"
              ? "Stran ima uporabne elemente, vendar več pomembnih signalov še manjka."
              : "Stran potrebuje več tehničnih in vsebinskih izboljšav, da bo primerna za pregledovanje."
    },
    technicalSignals: {
      status: pageResult.response.status,
      robotsStatus,
      blockedAgents: robotsInfo.blockedAgents,
      allowedAgents: robotsInfo.allowedAgents,
      sitemapAvailable,
      wordCount: words.length,
      lang,
      canonical: canonical || null,
      structuredDataCount
    },
    checks: allChecks,
    baseChecks,
    profileChecks: profileResult.checks,
    recommendations: buildRecommendation(allChecks)
  };
}

export const __internal = {
  parseRobots,
  evaluateRules,
  evaluateProfile,
  PAGE_PROFILES
};

export function normalizeUrlInput(input) {
  return normalizeTarget(input).toString();
}
