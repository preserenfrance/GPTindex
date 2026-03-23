import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

const FONT_CANDIDATES = {
  regular: [
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf"
  ],
  bold: [
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
  ]
};

const PAGE_SIZE = [595, 842];
const MARGIN_X = 42;
const TOP_Y = 796;
const BOTTOM_Y = 54;

async function firstReadablePath(paths) {
  for (const path of paths) {
    try {
      await access(path, fsConstants.R_OK);
      return path;
    } catch {
      continue;
    }
  }
  throw new Error("Ni bilo mogoče najti Unicode pisave za PDF poročilo.");
}

async function loadFonts(pdf) {
  pdf.registerFontkit(fontkit);

  const regularPath = await firstReadablePath(FONT_CANDIDATES.regular);
  const boldPath = await firstReadablePath(FONT_CANDIDATES.bold);

  const [regularBytes, boldBytes] = await Promise.all([
    readFile(regularPath),
    readFile(boldPath)
  ]);

  const [regular, bold] = await Promise.all([
    pdf.embedFont(regularBytes),
    pdf.embedFont(boldBytes)
  ]);

  return { regular, bold };
}

function createPage(pdf) {
  return pdf.addPage(PAGE_SIZE);
}

function ensureSpace(state, neededHeight = 24) {
  if (state.y - neededHeight >= BOTTOM_Y) {
    return;
  }

  state.page = createPage(state.pdf);
  state.y = TOP_Y;
}

function drawWrappedText(state, text, options = {}) {
  const {
    x = MARGIN_X,
    maxWidth = 510,
    lineHeight = 14,
    size = 10,
    font = state.fonts.regular,
    color = state.colors.text,
    bullet = false
  } = options;

  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  for (let index = 0; index < lines.length; index += 1) {
    ensureSpace(state, lineHeight + 4);
    const prefix = bullet && index === 0 ? "• " : "";
    state.page.drawText(`${prefix}${lines[index]}`, {
      x,
      y: state.y,
      size,
      font,
      color
    });
    state.y -= lineHeight;
  }
}

function drawLabelValue(state, label, value) {
  ensureSpace(state, 18);
  state.page.drawText(label, {
    x: MARGIN_X,
    y: state.y,
    size: 10,
    font: state.fonts.bold,
    color: state.colors.primary
  });
  state.page.drawText(String(value), {
    x: 170,
    y: state.y,
    size: 10,
    font: state.fonts.regular,
    color: state.colors.text
  });
  state.y -= 16;
}

function drawSectionTitle(state, title) {
  ensureSpace(state, 28);
  state.page.drawText(title, {
    x: MARGIN_X,
    y: state.y,
    size: 13,
    font: state.fonts.bold,
    color: state.colors.primary
  });
  state.y -= 18;
}

function drawCheckRow(state, check) {
  ensureSpace(state, 34);

  const badgeColor = check.passed ? state.colors.primarySoft : state.colors.accentSoft;
  const badgeTextColor = check.passed ? state.colors.primary : state.colors.accent;
  const badgeText = check.passed ? "POZITIVNO" : "NEGATIVNO";

  state.page.drawRectangle({
    x: MARGIN_X,
    y: state.y - 2,
    width: 82,
    height: 18,
    color: badgeColor
  });

  state.page.drawText(badgeText, {
    x: MARGIN_X + 8,
    y: state.y + 3,
    size: 8,
    font: state.fonts.bold,
    color: badgeTextColor
  });

  state.page.drawText(check.label, {
    x: MARGIN_X + 94,
    y: state.y + 1,
    size: 10,
    font: state.fonts.bold,
    color: state.colors.text
  });

  state.y -= 18;
  drawWrappedText(state, check.details, {
    x: MARGIN_X + 94,
    maxWidth: 410,
    lineHeight: 12,
    size: 9,
    color: state.colors.muted
  });
  state.y -= 6;
}

export async function createReportPdf({ mode, profileLabel, results }) {
  const pdf = await PDFDocument.create();
  const fonts = await loadFonts(pdf);
  const colors = {
    primary: rgb(0.13, 0.29, 0.65),
    primarySoft: rgb(0.93, 0.95, 1),
    accent: rgb(0.92, 0.5, 0.26),
    accentSoft: rgb(1, 0.94, 0.9),
    text: rgb(0.2, 0.2, 0.2),
    muted: rgb(0.45, 0.47, 0.47),
    white: rgb(1, 1, 1)
  };

  const state = {
    pdf,
    page: createPage(pdf),
    y: TOP_Y,
    fonts,
    colors
  };

  state.page.drawRectangle({
    x: MARGIN_X - 2,
    y: 754,
    width: 512,
    height: 56,
    color: colors.primary
  });

  state.page.drawText("ChatGPT Readiness Report", {
    x: MARGIN_X + 12,
    y: 782,
    size: 22,
    font: fonts.bold,
    color: colors.white
  });

  state.page.drawText(`Profil: ${profileLabel} | Način: ${mode === "crawl" ? "crawl domene" : "ročna analiza"}`, {
    x: MARGIN_X + 12,
    y: 764,
    size: 10,
    font: fonts.regular,
    color: colors.white
  });

  state.y = 724;

  for (const [index, result] of results.slice(0, 10).entries()) {
    ensureSpace(state, 160);

    state.page.drawText(`${index + 1}. ${result.summary.title}`, {
      x: MARGIN_X,
      y: state.y,
      size: 15,
      font: fonts.bold,
      color: colors.text
    });

    state.page.drawText(result.url, {
      x: MARGIN_X,
      y: state.y - 16,
      size: 9,
      font: fonts.regular,
      color: colors.muted
    });

    state.page.drawText(`${result.score}/100`, {
      x: 470,
      y: state.y,
      size: 15,
      font: fonts.bold,
      color: colors.primary
    });

    state.y -= 40;

    drawWrappedText(state, result.summary.description, {
      maxWidth: 500,
      lineHeight: 14,
      size: 10
    });
    state.y -= 6;

    drawLabelValue(state, "Verdikt", result.verdict.label);
    drawLabelValue(state, "HTTP status", result.technicalSignals.status);
    drawLabelValue(state, "Sitemap", result.technicalSignals.sitemapAvailable ? "Da" : "Ne");
    drawLabelValue(state, "Blokirani agenti", result.technicalSignals.blockedAgents.length ? result.technicalSignals.blockedAgents.join(", ") : "Brez blokad");
    drawLabelValue(state, "Besede", result.technicalSignals.wordCount);
    drawLabelValue(state, "Jezik", result.technicalSignals.lang || "Ni določen");

    state.y -= 4;
    drawSectionTitle(state, "Preverjeni kriteriji");

    for (const check of result.checks) {
      drawCheckRow(state, check);
    }

    if (result.recommendations.length) {
      drawSectionTitle(state, "Priporočila");
      for (const recommendation of result.recommendations) {
        drawWrappedText(state, recommendation, {
          x: MARGIN_X + 4,
          maxWidth: 500,
          lineHeight: 12,
          size: 9,
          color: colors.text,
          bullet: true
        });
      }
    }

    state.y -= 18;
  }

  return Buffer.from(await pdf.save());
}
