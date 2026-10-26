import iconv from 'iconv-lite';

import { KeilProjectError } from './errors';
import type { ProjectCharset, SourceCharset } from './model';

export interface DecodedProjectFile {
  text: string;
  charset: ProjectCharset;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return (
    buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix)
  );
}

function decodeUtf8Strict(buffer: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

function decodeGbStrict(buffer: Uint8Array, label = 'gb18030'): string {
  return new TextDecoder(label, { fatal: true }).decode(buffer);
}

/**
 * Validates that the buffer only contains byte sequences allowed by the
 * specific GB charset. Node's TextDecoder treats gb2312/gbk/gb18030 as
 * aliases, so this check is required to honour the declared encoding.
 */
function validateGbByteSequences(
  buffer: Buffer,
  charset: 'gb2312' | 'gbk' | 'gb18030',
): void {
  let index = 0;
  while (index < buffer.length) {
    const first = buffer[index];
    if (first <= 0x7f) {
      index += 1;
      continue;
    }

    if (charset === 'gb2312') {
      if (
        index + 1 >= buffer.length ||
        buffer[index + 1] < 0xa1 ||
        buffer[index + 1] > 0xfe ||
        first < 0xa1 ||
        first > 0xfe
      ) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 GB2312，但文件包含非 GB2312 字节。',
        );
      }
      index += 2;
      continue;
    }

    if (charset === 'gbk') {
      if (
        index + 1 >= buffer.length ||
        first < 0x81 ||
        first > 0xfe ||
        buffer[index + 1] < 0x40 ||
        buffer[index + 1] === 0x7f ||
        buffer[index + 1] > 0xfe
      ) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 GBK，但文件包含非 GBK 字节（可能是 GB18030 四字节字符）。',
        );
      }
      index += 2;
      continue;
    }

    // gb18030
    if (index + 1 >= buffer.length) {
      throw new KeilProjectError('encoding', 'GB18030 编码字节不完整。');
    }
    const second = buffer[index + 1];
    if (second >= 0x30 && second <= 0x39) {
      // Four-byte sequence: 81-FE / 30-39 / 81-FE / 30-39
      if (
        index + 3 >= buffer.length ||
        first < 0x81 ||
        first > 0xfe ||
        buffer[index + 2] < 0x81 ||
        buffer[index + 2] > 0xfe ||
        buffer[index + 3] < 0x30 ||
        buffer[index + 3] > 0x39
      ) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 GB18030，但文件包含无效的四字节序列。',
        );
      }
      index += 4;
    } else {
      // Double-byte sequence: 81-FE / 40-FE (excluding 0x7F)
      if (
        first < 0x81 ||
        first > 0xfe ||
        second < 0x40 ||
        second === 0x7f ||
        second > 0xfe
      ) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 GB18030，但文件包含无效的双字节序列。',
        );
      }
      index += 2;
    }
  }
}

function declarationEncoding(buffer: Buffer): string | undefined {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  const match = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(prefix);
  return match?.[1];
}

function normalizeDeclaredEncoding(value: string): ProjectCharset | 'ascii' {
  const normalized = value.trim().toLowerCase().replace(/[_\s]/g, '-');
  switch (normalized) {
    case 'utf-8':
    case 'utf8':
      return 'utf8';
    case 'gb2312':
    case 'gb-2312':
      return 'gb2312';
    case 'gbk':
      return 'gbk';
    case 'gb18030':
      return 'gb18030';
    case 'us-ascii':
    case 'ascii':
      return 'ascii';
    default:
      throw new KeilProjectError(
        'encoding',
        `不支持的工程文件编码声明："${value}"。仅支持 UTF-8、GB2312、GBK 和 GB18030。`,
      );
  }
}

function rejectUtf16(buffer: Buffer): void {
  if (startsWith(buffer, UTF16_LE_BOM) || startsWith(buffer, UTF16_BE_BOM)) {
    throw new KeilProjectError(
      'encoding',
      '工程文件是 UTF-16 编码，本扩展只支持 UTF-8 和 GB2312/GBK。',
    );
  }
  if (
    (buffer.length >= 2 && buffer[0] === 0x3c && buffer[1] === 0x00) ||
    (buffer.length >= 2 && buffer[0] === 0x00 && buffer[1] === 0x3c)
  ) {
    throw new KeilProjectError(
      'encoding',
      '工程文件看起来是 UTF-16 编码，本扩展只支持 UTF-8 和 GB2312/GBK。',
    );
  }
}

export function decodeProjectBytes(bytes: Uint8Array): DecodedProjectFile {
  const buffer = Buffer.from(bytes);
  rejectUtf16(buffer);

  const hasUtf8Bom = startsWith(buffer, UTF8_BOM);
  const content = hasUtf8Bom ? buffer.subarray(UTF8_BOM.length) : buffer;
  const declared = declarationEncoding(content);

  if (declared !== undefined) {
    const encoding = normalizeDeclaredEncoding(declared);
    if (encoding === 'utf8') {
      try {
        return {
          text: decodeUtf8Strict(content),
          charset: hasUtf8Bom ? 'utf8bom' : 'utf8',
        };
      } catch (error) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 UTF-8，但文件内容不是有效的 UTF-8，已中止以避免损坏工程。',
          error,
        );
      }
    }
    if (encoding === 'ascii') {
      if (content.some((byte) => byte > 0x7f)) {
        throw new KeilProjectError(
          'encoding',
          'XML 声明为 US-ASCII，但文件包含非 ASCII 字节。',
        );
      }
      return {
        text: content.toString('ascii'),
        charset: hasUtf8Bom ? 'utf8bom' : 'utf8',
      };
    }
    if (hasUtf8Bom) {
      throw new KeilProjectError(
        'encoding',
        `工程文件带 UTF-8 BOM，但 XML 声明为 ${declared}，声明与实际编码不一致。`,
      );
    }
    if (encoding !== 'gb2312' && encoding !== 'gbk' && encoding !== 'gb18030') {
      throw new KeilProjectError(
        'encoding',
        `不支持的工程文件编码声明：${declared}`,
      );
    }
    try {
      validateGbByteSequences(content, encoding);
      return {
        text: decodeGbStrict(content),
        charset: encoding,
      };
    } catch (error) {
      if (error instanceof KeilProjectError) {
        throw error;
      }
      throw new KeilProjectError(
        'encoding',
        `XML 声明为 ${declared}，但文件内容无法按该编码解码。`,
        error,
      );
    }
  }

  if (hasUtf8Bom) {
    try {
      return {
        text: decodeUtf8Strict(content),
        charset: 'utf8bom',
      };
    } catch (error) {
      throw new KeilProjectError(
        'encoding',
        '工程文件带 UTF-8 BOM，但内容不是有效的 UTF-8。',
        error,
      );
    }
  }

  try {
    return { text: decodeUtf8Strict(content), charset: 'utf8' };
  } catch {
    // Not UTF-8; try the GB family below.
  }

  try {
    return {
      text: decodeGbStrict(content),
      charset: 'gb18030',
    };
  } catch (error) {
    throw new KeilProjectError(
      'encoding',
      '无法识别工程文件编码。仅支持 UTF-8、UTF-8 BOM、GB2312、GBK 和 GB18030。',
      error,
    );
  }
}

function encodeGb(text: string, charset: 'gb2312' | 'gbk' | 'gb18030'): Buffer {
  return iconv.encode(text, charset);
}

export function encodeProjectText(text: string, charset: ProjectCharset): Buffer {
  let bytes: Buffer;
  if (charset === 'utf8') {
    bytes = Buffer.from(text, 'utf8');
  } else if (charset === 'utf8bom') {
    bytes = Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')]);
  } else {
    bytes = encodeGb(text, charset);
  }

  let decoded: string;
  try {
    if (charset === 'utf8' || charset === 'utf8bom') {
      const content = charset === 'utf8bom' ? bytes.subarray(UTF8_BOM.length) : bytes;
      decoded = decodeUtf8Strict(content);
    } else {
      validateGbByteSequences(bytes, charset);
      decoded = decodeGbStrict(bytes);
    }
  } catch (error) {
    if (error instanceof KeilProjectError) {
      throw error;
    }
    throw new KeilProjectError(
      'encoding',
      '工程文件内容无法按原编码写回，已中止。',
      error,
    );
  }

  if (decoded !== text) {
    throw new KeilProjectError(
      'encoding',
      '工程文件内容无法无损地按原编码写回，已中止以避免中文乱码。',
    );
  }
  return bytes;
}

export function encodeSourceText(text: string, charset: SourceCharset): Buffer {
  let bytes: Buffer;
  let decoderLabel: string;
  if (charset === 'utf8') {
    bytes = Buffer.from(text, 'utf8');
    decoderLabel = 'utf-8';
  } else if (charset === 'gb2312') {
    // GBK is a practical superset of GB2312 for source files. It keeps the
    // common Chinese characters working while remaining readable as GB2312.
    bytes = iconv.encode(text, 'gbk');
    decoderLabel = 'gb18030';
  } else if (charset === 'gbk') {
    bytes = iconv.encode(text, 'gbk');
    decoderLabel = 'gb18030';
  } else {
    bytes = iconv.encode(text, 'gb18030');
    decoderLabel = 'gb18030';
  }

  let decoded: string;
  try {
    decoded =
      decoderLabel === 'utf-8'
        ? decodeUtf8Strict(bytes)
        : decodeGbStrict(bytes, decoderLabel);
  } catch (error) {
    throw new KeilProjectError(
      'encoding',
      '源文件内容无法按选择的编码保存，已中止。',
      error,
    );
  }
  if (decoded !== text) {
    throw new KeilProjectError(
      'encoding',
      '源文件内容无法按选择的编码无损保存，请换用 UTF-8。',
    );
  }
  return bytes;
}

export function decodeSourceText(bytes: Uint8Array, charset: SourceCharset): string {
  try {
    if (charset === 'utf8') {
      return decodeUtf8Strict(bytes);
    }
    return decodeGbStrict(bytes, 'gb18030');
  } catch (error) {
    throw new KeilProjectError(
      'encoding',
      '读取源文件失败，文件内容与预期编码不一致。',
      error,
    );
  }
}

export function projectCharsetLabel(charset: ProjectCharset): string {
  switch (charset) {
    case 'utf8':
      return 'UTF-8';
    case 'utf8bom':
      return 'UTF-8 BOM';
    case 'gb2312':
      return 'GB2312';
    case 'gbk':
      return 'GBK';
    case 'gb18030':
      return 'GB18030';
  }
}

export function sourceCharsetLabel(charset: SourceCharset): string {
  return charset === 'utf8' ? 'UTF-8' : 'GB2312/GBK';
}

export function isGbProjectCharset(charset: ProjectCharset): boolean {
  return charset === 'gb2312' || charset === 'gbk' || charset === 'gb18030';
}
