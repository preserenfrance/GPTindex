import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function drawWrappedText(page, text, options) {
  const { x, y, maxWidth, lineHeight, font, size, color } = options;
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, size, font, color });
    cursorY -= lineHeight;
  }

  return cursorY;
}

export async function createReportPdf({ mode, profileLabel, results }) {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const blue = rgb(0.13, 0.29, 0.65);
  const orange = rgb(0.92, 0.5, 0.26);
  const dark = rgb(0.2, 0.2, 0.2);
  const gray = rgb(0.45, 0.47, 0.47);

  page.drawRectangle({
    x: 40,
    y: 760,
    width: 515,
    height: 52,
    color: blue
  });

  page.drawText("ChatGPT Readiness Report", {
    x: 56,
    y: 780,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1)
  });

  page.drawText(`Profil: ${profileLabel} | Nacin: ${mode === "crawl" ? "crawl domene" : "rocna analiza"}`, {
    x: 56,
    y: 762,
    size: 10,
    font,
    color: rgb(1, 1, 1)
  });

  let y = 730;
  for (const [index, result] of results.slice(0, 10).entries()) {
    if (y < 120) {
      y = 760;
      page = pdf.addPage([595, 842]);
    }

    page.drawText(`${index + 1}. ${result.summary.title}`, {
      x: 48,
      y,
      size: 14,
      font: bold,
      color: dark
    });
    page.drawText(`${result.url}`, {
      x: 48,
      y: y - 16,
      size: 9,
      font,
      color: gray
    });
    page.drawText(`Ocena: ${result.score}/100`, {
      x: 430,
      y,
      size: 13,
      font: bold,
      color: blue
    });
    page.drawRectangle({
      x: 48,
      y: y - 38,
      width: 90,
      height: 18,
      color: orange
    });
    page.drawText(result.verdict.label, {
      x: 54,
      y: y - 32,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1)
    });

    y = drawWrappedText(page, result.summary.description, {
      x: 48,
      y: y - 56,
      maxWidth: 495,
      lineHeight: 13,
      font,
      size: 10,
      color: dark
    });

    page.drawText("Top priporocila:", {
      x: 48,
      y: y - 8,
      size: 10,
      font: bold,
      color: blue
    });

    let recommendationY = y - 24;
    for (const recommendation of result.recommendations.slice(0, 3)) {
      recommendationY = drawWrappedText(page, `- ${recommendation}`, {
        x: 58,
        y: recommendationY,
        maxWidth: 480,
        lineHeight: 12,
        font,
        size: 9,
        color: dark
      });
    }

    y = recommendationY - 18;
  }

  return Buffer.from(await pdf.save());
}
