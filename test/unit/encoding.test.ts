import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import {
  decodeProjectBytes,
  decodeSourceText,
  encodeProjectText,
  encodeSourceText,
  isGbProjectCharset,
} from '../../src/core/encoding';
import type { SourceFileSample } from '../../src/core/model';
import {
  countSourceEncodings,
  detectSourceEncoding,
  recommendSourceEncoding,
} from '../../src/core/sourceEncoding';

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Targets>
    <Target>
      <TargetName>调试</TargetName>
    </Target>
  </Targets>
</Project>
`;

describe('project encoding', () => {
  it('decodes UTF-8', () => {
    const decoded = decodeProjectBytes(Buffer.from(SIMPLE_XML, 'utf8'));
    expect(decoded.charset).toBe('utf8');
    expect(decoded.text).toBe(SIMPLE_XML);
  });

  it('preserves a UTF-8 BOM and excludes it from the text', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(SIMPLE_XML, 'utf8'),
    ]);
    const decoded = decodeProjectBytes(bytes);
    expect(decoded.charset).toBe('utf8bom');
    expect(decoded.text).toBe(SIMPLE_XML);
    expect(encodeProjectText(decoded.text, decoded.charset).equals(bytes)).toBe(true);
  });

  it('decodes GB2312 declared files and writes them back as GB bytes', () => {
    const gbXml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="GB2312"');
    const bytes = iconv.encode(gbXml, 'gb2312');
    const decoded = decodeProjectBytes(bytes);
    expect(decoded.charset).toBe('gb2312');
    expect(decoded.text).toContain('调试');
    const encoded = encodeProjectText(decoded.text, decoded.charset);
    expect(encoded.equals(bytes)).toBe(true);
    expect(isGbProjectCharset(decoded.charset)).toBe(true);
  });

  it('decodes GBK declared files', () => {
    const gbXml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="GBK"');
    const bytes = iconv.encode(gbXml, 'gbk');
    const decoded = decodeProjectBytes(bytes);
    expect(decoded.charset).toBe('gbk');
    expect(decoded.text).toContain('调试');
  });

  it('detects undeclared GB content', () => {
    const xml = SIMPLE_XML.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml version="1.0"?>',
    );
    const bytes = iconv.encode(xml, 'gbk');
    const decoded = decodeProjectBytes(bytes);
    expect(decoded.charset).toBe('gb18030');
    expect(decoded.text).toContain('调试');
  });

  it('rejects a declaration that does not match the bytes', () => {
    const xml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="UTF-8"');
    const bytes = iconv.encode(xml, 'gbk');
    expect(() => decodeProjectBytes(bytes)).toThrow(/不是有效的 UTF-8/);
  });

  it('rejects UTF-16 files', () => {
    expect(() => decodeProjectBytes(Buffer.from([0xff, 0xfe, 0x3c, 0x00]))).toThrow(
      /UTF-16/,
    );
  });

  it('rejects unsupported declared encodings', () => {
    const xml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    expect(() => decodeProjectBytes(iconv.encode(xml, 'latin1'))).toThrow(
      /不支持的工程文件编码/,
    );
  });

  it('round-trips Chinese and special characters', () => {
    for (const charset of ['utf8', 'utf8bom', 'gb2312', 'gbk', 'gb18030'] as const) {
      const declaration =
        charset === 'gb2312'
          ? 'GB2312'
          : charset === 'gbk'
            ? 'GBK'
            : charset === 'gb18030'
              ? 'GB18030'
              : 'UTF-8';
      const text = SIMPLE_XML.replace(
        'encoding="UTF-8"',
        `encoding="${declaration}"`,
      ).replace('调试', '调试 & <测试> 中文');
      const bytes = encodeProjectText(text, charset);
      const decoded = decodeProjectBytes(bytes);
      expect(decoded.text).toBe(text);
      expect(decoded.charset).toBe(charset);
    }
  });

  it('rejects a GB2312 declaration that contains GBK-only bytes', () => {
    const xml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="GB2312"').replace(
      '调试',
      '丂',
    );
    expect(() => decodeProjectBytes(iconv.encode(xml, 'gbk'))).toThrow(/非 GB2312 字节/);
  });

  it('rejects a GBK declaration that contains GB18030 four-byte sequences', () => {
    const xml = SIMPLE_XML.replace('encoding="UTF-8"', 'encoding="GBK"').replace(
      '调试',
      '㐀',
    );
    expect(() => decodeProjectBytes(iconv.encode(xml, 'gb18030'))).toThrow(/非 GBK 字节/);
  });

  it('encodes project text with the declared GB charset and rejects mismatched characters', () => {
    expect(() => encodeProjectText('丂', 'gb2312')).toThrow(/非 GB2312 字节/);
    expect(() => encodeProjectText('㐀', 'gbk')).toThrow(/无法无损地按原编码写回/);
    const gb18030Bytes = encodeProjectText('👋', 'gb18030');
    expect(gb18030Bytes.length).toBe(4);
    expect(decodeProjectBytes(gb18030Bytes).text).toBe('👋');
  });
});

describe('source encoding detection', () => {
  it('marks pure ASCII as neutral', () => {
    const detection = detectSourceEncoding(Buffer.from('int main(void) {}'));
    expect(detection.category).toBe('neutral');
  });

  it('detects UTF-8 Chinese text', () => {
    const detection = detectSourceEncoding(Buffer.from('// 中文注释', 'utf8'));
    expect(detection.category).toBe('utf8');
    expect(detection.charset).toBe('utf8');
  });

  it('prefers UTF-8 for bytes that are also valid GBK', () => {
    const bytes = Buffer.from('// 中文', 'utf8');
    expect(detectSourceEncoding(bytes).category).toBe('utf8');
  });

  it('detects GBK Chinese text', () => {
    const bytes = iconv.encode('// 中文注释', 'gbk');
    const detection = detectSourceEncoding(bytes);
    expect(detection.category).toBe('gb');
    expect(detection.charset).toBe('gb2312');
  });

  it('excludes invalid GB bytes such as Windows-1252 fragments', () => {
    const detection = detectSourceEncoding(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    expect(detection.category).toBe('other');
  });

  it('detects UTF-8 BOM source as UTF-8', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('// ascii', 'utf8'),
    ]);
    const detection = detectSourceEncoding(bytes);
    expect(detection.category).toBe('utf8');
    expect(detection.hasBom).toBe(true);
  });

  it('counts categories', () => {
    const samples: SourceFileSample[] = [
      { path: 'a.c', bytes: Buffer.from('int a;') },
      { path: 'b.c', bytes: Buffer.from('// 中文', 'utf8') },
      { path: 'c.c', bytes: iconv.encode('// 中文', 'gbk') },
      { path: 'd.c', bytes: Buffer.from([0x81]) },
    ];
    expect(countSourceEncodings(samples)).toEqual({
      utf8: 1,
      gb: 1,
      neutral: 1,
      other: 1,
    });
  });

  it('encodes source text without adding a BOM', () => {
    const bytes = encodeSourceText('// 中文', 'gb2312');
    expect(bytes[0]).not.toBe(0xef);
    expect(new TextDecoder('gb18030').decode(bytes)).toBe('// 中文');
    expect(decodeSourceText(bytes, 'gb2312')).toBe('// 中文');
  });

  it('rejects characters that cannot be represented in GB2312/GBK', () => {
    expect(() => encodeSourceText('// 😀', 'gb2312')).toThrow(/无法按选择的编码/);
  });
});

describe('source encoding recommendation', () => {
  const utf8 = { path: 'u.c', bytes: Buffer.from('// 中文', 'utf8') };
  const gb = { path: 'g.c', bytes: iconv.encode('// 中文', 'gbk') };
  const ascii = { path: 'a.c', bytes: Buffer.from('int a;') };

  it('honours an explicit setting first', () => {
    const result = recommendSourceEncoding({
      setting: 'gb2312',
      folderSamples: [utf8],
      groupSamples: [],
      projectSamples: [],
    });
    expect(result.charset).toBe('gb2312');
    expect(result.source).toBe('setting');
  });

  it('honours a remembered directory choice', () => {
    const result = recommendSourceEncoding({
      setting: 'auto',
      remembered: 'gb2312',
      folderSamples: [utf8],
      groupSamples: [],
      projectSamples: [],
    });
    expect(result.charset).toBe('gb2312');
    expect(result.fromMemory).toBe(true);
  });

  it('uses the folder majority before the group', () => {
    const result = recommendSourceEncoding({
      setting: 'auto',
      folderSamples: [utf8, ascii],
      groupSamples: [gb],
      projectSamples: [],
    });
    expect(result.charset).toBe('utf8');
    expect(result.source).toBe('folder');
    expect(result.counts.neutral).toBe(1);
  });

  it('asks when the folder mixes UTF-8 and GB', () => {
    const result = recommendSourceEncoding({
      setting: 'auto',
      folderSamples: [utf8, gb],
      groupSamples: [],
      projectSamples: [],
    });
    expect(result.ambiguous).toBe(true);
    expect(result.source).toBe('ask');
  });

  it('falls back to the group and then the project', () => {
    const groupResult = recommendSourceEncoding({
      setting: 'auto',
      folderSamples: [ascii],
      groupSamples: [gb],
      projectSamples: [utf8],
    });
    expect(groupResult.source).toBe('group');
    expect(groupResult.charset).toBe('gb2312');

    const projectResult = recommendSourceEncoding({
      setting: 'auto',
      folderSamples: [ascii],
      groupSamples: [ascii],
      projectSamples: [utf8],
    });
    expect(projectResult.source).toBe('project');
    expect(projectResult.charset).toBe('utf8');
  });

  it('asks with UTF-8 default when no non-ASCII samples exist', () => {
    const result = recommendSourceEncoding({
      setting: 'auto',
      folderSamples: [ascii],
      groupSamples: [ascii],
      projectSamples: [ascii],
    });
    expect(result.source).toBe('ask');
    expect(result.charset).toBe('utf8');
  });
});
