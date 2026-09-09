import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;
const FONT_FAMILY = 'DejaVu Sans';

type TextComposite = {
  input: Buffer;
  left: number;
  top: number;
  blend: 'over';
};

interface TextBlockOptions {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  minFontSize: number;
  maxLines: number;
  lineGap: number;
  color: string;
  bold: boolean;
  align?: 'left' | 'center';
}

function resolveBundledFont(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets', 'fonts', fileName),
    path.resolve(process.cwd(), '..', 'assets', 'fonts', fileName),
  ];

  if (typeof __dirname === 'string') {
    candidates.push(
      path.resolve(__dirname, 'fonts', fileName),
      path.resolve(__dirname, '..', 'assets', 'fonts', fileName)
    );
  }

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `Không tìm thấy font đóng gói ${fileName}. Đã kiểm tra: ${candidates.join(', ')}`
    );
  }
  return resolved;
}

const REGULAR_FONT_PATH = resolveBundledFont('DejaVuSans.ttf');
const BOLD_FONT_PATH = resolveBundledFont('DejaVuSans-Bold.ttf');

function escapePango(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

async function renderLine(
  text: string,
  fontSize: number,
  bold: boolean,
  color: string
): Promise<{ data: Buffer; width: number; height: number }> {
  const fontfile = bold ? BOLD_FONT_PATH : REGULAR_FONT_PATH;
  const markup = `<span foreground="${color}">${escapePango(text)}</span>`;
  const { data, info } = await sharp({
    text: {
      text: markup,
      font: `${FONT_FAMILY} ${fontSize}`,
      fontfile,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
  };
}

async function wrapAtPixelWidth(
  text: string,
  maxWidth: number,
  maxLines: number,
  fontSize: number,
  bold: boolean,
  color: string
): Promise<{ lines: string[]; rendered: Awaited<ReturnType<typeof renderLine>>[]; fits: boolean }> {
  const words = cleanText(text).split(' ').filter(Boolean);
  if (words.length === 0) {
    return { lines: [], rendered: [], fits: true };
  }

  const measureCache = new Map<string, Awaited<ReturnType<typeof renderLine>>>();
  const measure = async (value: string) => {
    const cached = measureCache.get(value);
    if (cached) return cached;
    const result = await renderLine(value, fontSize, bold, color);
    measureCache.set(value, result);
    return result;
  };

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateImage = await measure(candidate);
    if (candidateImage.width <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const rendered = await Promise.all(lines.map((line) => measure(line)));
  const fits =
    lines.length <= maxLines && rendered.every((lineImage) => lineImage.width <= maxWidth);

  return { lines, rendered, fits };
}

async function createTextBlock(options: TextBlockOptions): Promise<TextComposite[]> {
  const {
    text,
    left,
    top,
    width,
    height,
    fontSize,
    minFontSize,
    maxLines,
    lineGap,
    color,
    bold,
    align = 'center',
  } = options;

  const normalized = cleanText(text);
  if (!normalized) return [];

  let layout: Awaited<ReturnType<typeof wrapAtPixelWidth>> | null = null;
  let chosenSize = fontSize;

  for (let size = fontSize; size >= Math.max(18, minFontSize); size -= 1) {
    const candidate = await wrapAtPixelWidth(normalized, width, maxLines, size, bold, color);
    const textHeight =
      candidate.rendered.reduce((sum, line) => sum + line.height, 0) +
      Math.max(0, candidate.rendered.length - 1) * lineGap;
    if (candidate.fits && textHeight <= height) {
      layout = candidate;
      chosenSize = size;
      break;
    }
  }

  if (!layout) {
    layout = await wrapAtPixelWidth(
      normalized,
      width,
      maxLines,
      Math.max(18, minFontSize),
      bold,
      color
    );
    chosenSize = Math.max(18, minFontSize);
  }

  if (!layout.fits) {
    throw new Error(
      `Nội dung quá dài để đặt an toàn trong ${maxLines} dòng ở cỡ chữ tối thiểu ${chosenSize}px: "${normalized}"`
    );
  }

  const totalHeight =
    layout.rendered.reduce((sum, line) => sum + line.height, 0) +
    Math.max(0, layout.rendered.length - 1) * lineGap;
  let cursorY = top + Math.max(0, Math.round((height - totalHeight) / 2));

  return layout.rendered.map((lineImage) => {
    const x =
      align === 'left'
        ? left
        : left + Math.max(0, Math.round((width - lineImage.width) / 2));
    const item: TextComposite = {
      input: lineImage.data,
      left: x,
      top: cursorY,
      blend: 'over',
    };
    cursorY += lineImage.height + lineGap;
    return item;
  });
}

export interface OverlayOptions {
  structure: string;
  explanation?: string;
  vi: string;
  en: string;
  showAnswer: boolean;
}

export async function generateCardOverlayPng(options: OverlayOptions): Promise<Buffer> {
  const { structure, explanation, vi, en, showAnswer } = options;
  const composites: TextComposite[] = [];

  if (cleanText(explanation ?? '')) {
    composites.push(
      ...(await createTextBlock({
        text: structure,
        left: 95,
        top: 291,
        width: 530,
        height: 91,
        fontSize: 44, // 34px × 1.30, rounded
        minFontSize: 26,
        maxLines: 2,
        lineGap: 3,
        color: '#FFFFFF',
        bold: true,
      })),
      ...(await createTextBlock({
        text: explanation ?? '',
        left: 91,
        top: 384,
        width: 538,
        height: 65,
        fontSize: 29, // 22px × 1.30, rounded
        minFontSize: 18,
        maxLines: 2,
        lineGap: 3,
        color: '#F8FAFC',
        bold: false,
      }))
    );
  } else {
    composites.push(
      ...(await createTextBlock({
        text: structure,
        left: 95,
        top: 305,
        width: 530,
        height: 136,
        fontSize: 47, // 36px × 1.30, rounded
        minFontSize: 24,
        maxLines: 3,
        lineGap: 5,
        color: '#FFFFFF',
        bold: true,
      }))
    );
  }

  composites.push(
    ...(await createTextBlock({
      text: vi,
      left: 82,
      top: 570,
      width: 556,
      height: 112,
      fontSize: 44,
      minFontSize: 26,
      maxLines: 3,
      lineGap: 5,
      color: '#FFFFFF',
      bold: true,
    }))
  );

  if (showAnswer) {
    composites.push(
      ...(await createTextBlock({
        text: en,
        left: 82,
        top: 731,
        width: 556,
        height: 117,
        fontSize: 43,
        minFontSize: 25,
        maxLines: 3,
        lineGap: 5,
        color: '#B7B8BA',
        bold: true,
      }))
    );
  }

  // CTA: increase the approved 29px text by another 30% (29 × 1.30 = 37.7 -> 38px).
  // The usable width is widened to 680px so both fixed lines stay at exactly 38px.
  composites.push(
    ...(await createTextBlock({
      text: 'Vào nhóm trong bình luận để',
      left: 20,
      top: 928,
      width: 680,
      height: 50,
      fontSize: 38,
      minFontSize: 38,
      maxLines: 1,
      lineGap: 0,
      color: '#FACC15',
      bold: true,
    })),
    ...(await createTextBlock({
      text: 'luyện nghe - nói cùng Hà',
      left: 20,
      top: 978,
      width: 680,
      height: 50,
      fontSize: 38,
      minFontSize: 38,
      maxLines: 1,
      lineGap: 0,
      color: '#FACC15',
      bold: true,
    }))
  );

  const baseSvg = `
<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect x="65" y="282" width="590" height="182" rx="24" fill="#EA580C" stroke="#FB923C" stroke-width="2" filter="url(#shadow)"/>
  <rect x="58" y="540" width="604" height="334" rx="24" fill="#070B16" fill-opacity="0.92" stroke="#FFFFFF" stroke-opacity="0.15" stroke-width="1.5" filter="url(#shadow)"/>
  <line x1="118" y1="707" x2="602" y2="707" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1"/>
</svg>`;

  return sharp(Buffer.from(baseSvg))
    .composite(composites)
    .png()
    .toBuffer();
}
