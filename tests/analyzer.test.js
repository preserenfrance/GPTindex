import assert from "node:assert/strict";
import { __internal, normalizeUrlInput } from "../src/analyzer.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("parseRobots detects disallowed AI agents", () => {
  const robots = `
User-agent: *
Disallow: /private
Sitemap: https://example.com/sitemap.xml
  `.trim();

  const result = __internal.parseRobots(robots, "/private/page");

  assert.deepEqual(result.blockedAgents.sort(), ["ChatGPT-User", "GPTBot", "OAI-SearchBot"].sort());
  assert.equal(result.sitemaps[0], "https://example.com/sitemap.xml");
});

run("evaluateRules rewards a healthy page setup", () => {
  const results = __internal.evaluateRules({
    protocol: "https:",
    httpOk: true,
    status: 200,
    blockedAgents: [],
    title: "Zelo jasen naslov strani za preizkus",
    description: "To je dovolj dolg meta description, da ga bo pravilo sprejelo brez težav.",
    canonical: "https://example.com/article",
    lang: "sl",
    structuredDataCount: 1,
    wordCount: 420,
    headingCount: 4,
    paragraphCount: 5,
    sitemapAvailable: true,
    metaRobotsFlags: []
  });

  assert.ok(results.every((item) => item.passed));
});

run("evaluateProfile returns blog-specific checks", () => {
  const profile = __internal.evaluateProfile("blog", {
    title: "Dolga in jasna naslovna vrstica blog objave",
    articleSignals: {
      articleTagCount: 1,
      blogSchemaCount: 1,
      authorSignals: 1,
      dateSignals: 1
    },
    commerceSignals: {
      productSchemaCount: 0,
      priceSignals: 0,
      availabilitySignals: 0
    },
    landingSignals: {
      h1Count: 1,
      ctaSignals: 0,
      trustSignals: 0,
      faqSchemaCount: 0
    }
  });

  assert.equal(profile.profile, "blog");
  assert.equal(profile.checks.length, 3);
  assert.ok(profile.checks.every((item) => item.passed));
});

run("normalizeUrlInput adds https when missing", () => {
  assert.equal(normalizeUrlInput("example.com"), "https://example.com/");
});
