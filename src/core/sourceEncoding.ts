import iconv from 'iconv-lite';

import type {
  EncodingCounts,
  EncodingRecommendation,
  SourceCharset,
  SourceFileSample,
} from './model';

export type SourceEncodingCategory = 'utf8' | 'gb' | 'neutral' | 'other';

export interface SourceEncodingDetection {
  category: SourceEncodingCategory;
  charset?: SourceCharset;
  hasBom: boolean;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return (
    buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix)
  );
}

function isAscii(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte > 0x7f) {
      return false;
    }
  }
  return true;
}

function detectGb(buffer: Buffer): SourceCharset | undefined {
  let text: string;
  try {
    text = new TextDecoder('gb18030', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }

  let reencoded: Buffer;
  try {
    reencoded = iconv.encode(text, 'gb18030');
  } catch {
    return undefined;
  }
  if (!reencoded.equals(buffer)) {
    return undefined;
  }

  try {
    if (iconv.encode(text, 'gb2312').equals(buffer)) {
      return 'gb2312';
    }
  } catch {
    // Fall through to GBK.
  }
  return 'gbk';
}

export function detectSourceEncoding(bytes: Uint8Array): SourceEncodingDetection {
  const buffer = Buffer.from(bytes);
  if (buffer.length === 0) {
    return { category: 'neutral', hasBom: false };
  }
  if (startsWith(buffer, UTF16_LE_BOM) || startsWith(buffer, UTF16_BE_BOM)) {
    return { category: 'other', hasBom: false };
  }
  if (startsWith(buffer, UTF8_BOM)) {
    const content = buffer.subarray(UTF8_BOM.length);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
      return { category: 'utf8', charset: 'utf8', hasBom: true };
    } catch {
      return { category: 'other', hasBom: true };
    }
  }
  if (isAscii(buffer)) {
    return { category: 'neutral', hasBom: false };
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    // UTF-8 is always tested first so files that can also be decoded as GBK
    // are not misclassified as GB.
    return { category: 'utf8', charset: 'utf8', hasBom: false };
  } catch {
    // Continue with GB detection.
  }

  const gb = detectGb(buffer);
  if (gb) {
    return { category: 'gb', charset: gb, hasBom: false };
  }
  return { category: 'other', hasBom: false };
}

export function emptyEncodingCounts(): EncodingCounts {
  return { utf8: 0, gb: 0, neutral: 0, other: 0 };
}

export function countSourceEncodings(
  samples: readonly SourceFileSample[],
): EncodingCounts {
  const counts = emptyEncodingCounts();
  for (const sample of samples) {
    const detection = detectSourceEncoding(sample.bytes);
    counts[detection.category] += 1;
  }
  return counts;
}

export interface RecommendSourceEncodingInput {
  setting: 'auto' | 'utf8' | 'gb2312';
  remembered?: SourceCharset;
  folderSamples: readonly SourceFileSample[];
  groupSamples: readonly SourceFileSample[];
  projectSamples: readonly SourceFileSample[];
}

function chooseFromCounts(
  counts: EncodingCounts,
  source: 'folder' | 'group' | 'project',
): EncodingRecommendation | undefined {
  const votes = counts.utf8 + counts.gb;
  if (votes === 0) {
    return undefined;
  }
  const ambiguous = counts.utf8 > 0 && counts.gb > 0;
  const charset: SourceCharset = counts.utf8 >= counts.gb ? 'utf8' : 'gb2312';
  return {
    charset,
    source: ambiguous ? 'ask' : source,
    counts,
    ambiguous,
    fromMemory: false,
  };
}

export function recommendSourceEncoding(
  input: RecommendSourceEncodingInput,
): EncodingRecommendation {
  if (input.setting !== 'auto') {
    return {
      charset: input.setting,
      source: 'setting',
      counts: emptyEncodingCounts(),
      ambiguous: false,
      fromMemory: false,
    };
  }

  const folderCounts = countSourceEncodings(input.folderSamples);
  if (input.remembered) {
    return {
      charset: input.remembered,
      source: 'folder',
      counts: folderCounts,
      ambiguous: folderCounts.utf8 > 0 && folderCounts.gb > 0,
      fromMemory: true,
    };
  }

  const fromFolder = chooseFromCounts(folderCounts, 'folder');
  if (fromFolder) {
    return fromFolder;
  }

  const groupCounts = countSourceEncodings(input.groupSamples);
  const fromGroup = chooseFromCounts(groupCounts, 'group');
  if (fromGroup) {
    return fromGroup;
  }

  const projectCounts = countSourceEncodings(input.projectSamples);
  const fromProject = chooseFromCounts(projectCounts, 'project');
  if (fromProject) {
    return fromProject;
  }

  return {
    charset: 'utf8',
    source: 'ask',
    counts: emptyEncodingCounts(),
    ambiguous: false,
    fromMemory: false,
  };
}

export function encodingCountsLabel(counts: EncodingCounts): string {
  return `UTF-8 ${counts.utf8} · GB ${counts.gb} · 纯 ASCII ${counts.neutral} · 其他 ${counts.other}`;
}
