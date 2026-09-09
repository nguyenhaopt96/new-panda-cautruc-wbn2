import { ParsedLesson, ContentPair } from '../types';

export interface BatchParseResult {
  lessons: ParsedLesson[];
  errors: string[];
  detectedCount: number;
}

interface InternalParseResult {
  lesson: ParsedLesson;
  pairCount: number;
  hasStructure: boolean;
}

const STRUCTURE_LINE = /^(?:#{1,6}\s*)?(cấu trúc|cau truc|structure)\s*:/i;
const EXPLANATION_LINE = /^(giải thích|giai thich|nghĩa|nghia|explanation|meaning)\s*:/i;
const LESSON_TITLE_LINE = /^(?:["“”]\s*)?(?:bài|bai|lesson)\s+(?:số\s*)?\d+\b/i;
const LESSON_SEPARATOR = /^\s*(?:-{3,}|={3,})\s*$/m;

/**
 * Repair text copied from chat, Docs or Facebook where every line break was
 * removed. This is deliberately rule-based: lesson labels, pair numbers and
 * answer arrows are explicit delimiters, so no AI/API is needed.
 */
export function normalizeLessonInput(rawText: string): string {
  let text = String(rawText ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (!text) return '';

  // Restore boundaries between glued lessons and their labelled fields.
  text = text
    .replace(/\s*["“”]?\s*((?:bài|bai|lesson)\s+(?:số\s*)?\d+\b)/giu, '\n$1')
    .replace(/\s*((?:cấu\s*trúc|cau\s*truc|structure)\s*:)/giu, '\n$1')
    .replace(
      /\s*((?:giải\s*thích|giai\s*thich|nghĩa|nghia|explanation|meaning)\s*:)/giu,
      '\n$1'
    );

  // A numbered Vietnamese prompt and its arrow answer form one pair. The
  // negative lookbehind avoids treating decimal values such as 2.5 as a pair.
  text = text
    .replace(/(?<!\d)([1-9]\d*)[.)]\s*(?=(?:VI\s*[:\-]\s*)?[\p{L}"“])/gu, '\n$1. ')
    .replace(/\s*(?:→|➜|➡️?|=>|->)\s*/gu, '\n→ ');

  return text
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Parse one lesson. This keeps the original single-lesson behaviour by filling
 * missing pairs with preview placeholders. Batch rendering uses
 * parseLessonBatch(), which rejects incomplete lessons before upload.
 */
export function parseLessonText(rawText: string): ParsedLesson {
  return parseLessonBlock(rawText).lesson;
}

/**
 * Split a paste containing many lessons. The preferred format is simply to
 * repeat "Cấu trúc:" for every lesson; no special separator is required.
 * Lines such as "BÀI 12" before a structure are deliberately ignored.
 */
export function parseLessonBatch(rawText: string): BatchParseResult {
  const normalized = normalizeLessonInput(rawText);
  if (!normalized) {
    return { lessons: [], errors: ['Chưa có nội dung bài học.'], detectedCount: 0 };
  }

  const allLines = normalized.split('\n');
  const structureStarts: number[] = [];
  allLines.forEach((line, index) => {
    if (STRUCTURE_LINE.test(line.trim())) structureStarts.push(index);
  });

  let blocks: string[];
  if (structureStarts.length > 0) {
    blocks = structureStarts.map((start, index) => {
      const end = structureStarts[index + 1] ?? allLines.length;
      return allLines.slice(start, end).join('\n').trim();
    });
  } else {
    blocks = normalized
      .split(LESSON_SEPARATOR)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  const lessons: ParsedLesson[] = [];
  const errors: string[] = [];

  blocks.forEach((block, index) => {
    const parsed = parseLessonBlock(block);
    lessons.push(parsed.lesson);

    if (!parsed.hasStructure) {
      errors.push(`Bài ${index + 1}: thiếu dòng "Cấu trúc:".`);
    }
    if (parsed.pairCount !== 3) {
      errors.push(`Bài ${index + 1}: tìm thấy ${parsed.pairCount} cặp Việt–Anh, cần đúng 3 cặp.`);
    }
  });

  return {
    lessons,
    errors,
    detectedCount: blocks.length,
  };
}

function parseLessonBlock(rawText: string): InternalParseResult {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let structure = '';
  let explanation = '';
  let hasStructure = false;
  const explanationLines: string[] = [];
  const remainingLines: string[] = [];
  let explanationStarted = false;
  let contentStarted = false;

  for (const line of lines) {
    if (LESSON_TITLE_LINE.test(line)) {
      continue;
    }
    if (STRUCTURE_LINE.test(line)) {
      hasStructure = true;
      structure = line.replace(STRUCTURE_LINE, '').trim();
      continue;
    }

    if (EXPLANATION_LINE.test(line)) {
      explanationStarted = true;
      const first = line.replace(EXPLANATION_LINE, '').trim();
      if (first) explanationLines.push(first);
      continue;
    }

    const looksLikeContent = /^(?:\d+[\.\)]\s*)?(?:vi|en)\s*[:\-]/i.test(line) || /^\d+[\.\)]\s+/.test(line) || line.includes('\t');
    if (looksLikeContent) contentStarted = true;

    if (explanationStarted && !contentStarted && explanationLines.length < 2) {
      explanationLines.push(line);
    } else {
      remainingLines.push(line);
    }
  }

  explanation = explanationLines.slice(0, 2).join(' ');
  const candidatePairs = extractPairs(remainingLines);

  if (!structure) structure = 'Cấu trúc bài học';
  if (!explanation) explanation = 'Mẫu câu giao tiếp thực hành hàng ngày';

  const finalPairs: ContentPair[] = [];
  for (let index = 0; index < 3; index++) {
    finalPairs.push(
      candidatePairs[index] || {
        vi: `Câu mẫu tiếng Việt ${index + 1}`,
        en: `Sample English sentence ${index + 1}`,
      }
    );
  }

  return {
    lesson: { structure, explanation, pairs: finalPairs },
    pairCount: candidatePairs.length,
    hasStructure: hasStructure && structure.length > 0,
  };
}

function extractPairs(lines: string[]): ContentPair[] {
  const pairs: ContentPair[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.includes('\t')) {
      const parts = line.split('\t').map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const vi = cleanSentence(parts[0]);
        const en = cleanSentence(parts[1]);
        if (vi && en) pairs.push({ vi, en });
        continue;
      }
    }

    if (/^(?:\d+[\.\)]\s*)?vi\s*[:\-]/i.test(line)) {
      const vi = cleanSentence(line);
      const next = lines[index + 1] || '';
      if (/^(?:\d+[\.\)]\s*)?en\s*[:\-]/i.test(next)) {
        const en = cleanSentence(next);
        if (vi && en) pairs.push({ vi, en });
        index++;
      }
      continue;
    }

    const numbered = line.match(/^\d+[\.\)]\s*(.*)$/);
    if (numbered && index + 1 < lines.length) {
      const vi = cleanSentence(numbered[1]);
      const next = lines[index + 1];
      if (!/^\d+[\.\)]/.test(next)) {
        const en = cleanSentence(next);
        if (vi && en) pairs.push({ vi, en });
        index++;
        continue;
      }
    }

    if (index + 1 < lines.length) {
      const vi = cleanSentence(line);
      const en = cleanSentence(lines[index + 1]);
      if (vi && en) {
        pairs.push({ vi, en });
        index++;
      }
    }
  }

  return pairs;
}

function cleanSentence(text: string): string {
  return text
    .replace(/^(?:\d+[\.\)]\s*)?(?:vi|en)\s*[:\-]\s*/i, '')
    .replace(/^(?:→|➜|➡️?|=>|->)\s*/u, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .trim();
}
