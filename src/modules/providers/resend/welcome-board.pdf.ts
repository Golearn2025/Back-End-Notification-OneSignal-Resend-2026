import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Cream / off-white name colour matching the official board. */
const NAME_WHITE = rgb(0.957, 0.937, 0.894);

function guestDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): string {
  const full = (input.fullName ?? '').trim().replace(/\s+/g, ' ');
  if (full) return full;
  const first = (input.firstName ?? '').trim();
  const last = (input.lastName ?? '').trim();
  const joined = [first, last].filter(Boolean).join(' ');
  return joined || 'Guest';
}

function templatePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../docs/resend-templates/assets/welcome-board-template.pdf'
  );
}

/**
 * Always 2 lines: prenume / nume when both known; otherwise first word / rest.
 */
function splitAlwaysTwoLines(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): string[] {
  const first = (input.firstName ?? '').trim();
  const last = (input.lastName ?? '').trim();
  if (first && last) {
    return [first, last];
  }

  const full = guestDisplayName(input);
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return [words[0]!, words.slice(1).join(' ')];
  }
  return [full];
}

/**
 * One shared size for both lines — limited by the wider line so both match,
 * and both fit inside maxWidth (leaving side padding).
 */
function sizeForLines(lines: string[], font: PDFFont, maxWidth: number): number {
  const maxSize = 130;
  const minSize = 26;
  let widestUnit = 0;
  for (const line of lines) {
    widestUnit = Math.max(widestUnit, font.widthOfTextAtSize(line, 1));
  }
  if (widestUnit <= 0) return minSize;
  return Math.max(minSize, Math.min(maxSize, maxWidth / widestUnit));
}

function drawCenteredLines(
  page: PDFPage,
  lines: string[],
  opts: {
    font: PDFFont;
    size: number;
    color: ReturnType<typeof rgb>;
    centerX: number;
    centerY: number;
    lineGap: number;
  }
): void {
  const { font, size, color, centerX, centerY, lineGap } = opts;
  const blockHeight = lines.length * size + (lines.length - 1) * lineGap;
  let y = centerY + blockHeight / 2 - size * 0.78;
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: centerX - w / 2,
      y,
      size,
      font,
      color
    });
    y -= size + lineGap;
  }
}

/**
 * Blank branded template + guest name always on 2 lines (prenume / nume),
 * same font size, auto-resized to fill width with padding from the gold rule.
 */
export async function buildWelcomeBoardPdf(input: {
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerFullName?: string | null;
  bookingReference?: string | null;
}): Promise<{ bytes: Uint8Array; filename: string; guestName: string }> {
  const guestName = guestDisplayName({
    firstName: input.customerFirstName,
    lastName: input.customerLastName,
    fullName: input.customerFullName
  });
  const ref = (input.bookingReference ?? '').trim() || 'booking';
  const safeRef = ref.replace(/[^a-zA-Z0-9_-]+/g, '-');

  const templateBytes = readFileSync(templatePath());
  const templatePdf = await PDFDocument.load(templateBytes);
  const out = await PDFDocument.create();
  const [templatePage] = await out.copyPages(templatePdf, [0]);
  out.addPage(templatePage);
  const page = out.getPages()[0]!;
  const { width, height } = page.getSize();

  // Gap from gold rule (left) and page edge (right) — never flush.
  const panelLeft = width * 0.42;
  const panelRight = width * 0.93;
  // Extra inset so the widest line still breathes left/right.
  const maxNameWidth = (panelRight - panelLeft) * 0.92;
  const rightCenterX = (panelLeft + panelRight) / 2;
  const nameCenterY = height * 0.50;

  const lines = splitAlwaysTwoLines({
    firstName: input.customerFirstName,
    lastName: input.customerLastName,
    fullName: input.customerFullName
  });

  const serifBold = await out.embedFont(StandardFonts.TimesRomanBold);
  const size = sizeForLines(lines, serifBold, maxNameWidth);

  drawCenteredLines(page, lines, {
    font: serifBold,
    size,
    color: NAME_WHITE,
    centerX: rightCenterX,
    centerY: nameCenterY,
    lineGap: Math.max(10, size * 0.14)
  });

  const bytes = await out.save();
  return {
    bytes,
    filename: `Vantage-Lane-Welcome-Board-${safeRef}.pdf`,
    guestName
  };
}
