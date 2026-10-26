export type ProjectCharset = 'utf8' | 'utf8bom' | 'gb2312' | 'gbk' | 'gb18030';
export type SourceCharset = 'utf8' | 'gb2312' | 'gbk' | 'gb18030';
export type Eol = '\n' | '\r\n';

export interface FileNode {
  name: string;
  fileType: number;
  path: string;
}

export interface GroupNode {
  name: string;
  files: FileNode[];
  /** Offset of the `<` in `</Group>`, or in `<Group/>` when self-closing. */
  groupClose: number;
  /** Offset of the `<` in `</Files>`, if a `<Files>` element exists. */
  filesClose?: number;
  /** True when `<Files>` is self-closing (`<Files />`). */
  filesIsSelfClosing?: boolean;
  /** True when the group itself is self-closing (`<Group />`). */
  groupIsSelfClosing?: boolean;
}

export interface TargetNode {
  name: string;
  groups: GroupNode[];
  /** Offset of the `<` in `</Target>`. */
  targetClose: number;
  /** Offset of the `<` in `</Groups>`, if a `<Groups>` element exists. */
  groupsClose?: number;
  /** True when `<Groups>` is self-closing (`<Groups />`). */
  groupsIsSelfClosing?: boolean;
}

export interface ProjectDocument {
  /** Absolute path to the `.uvprojx` file. */
  path: string;
  /** Decoded text. A UTF-8 BOM is not part of this string. */
  text: string;
  charset: ProjectCharset;
  eol: Eol;
  /** Detected indentation unit, e.g. two spaces or a tab. */
  indentUnit: string;
  targets: TargetNode[];
}

export interface FileToAdd {
  fileName: string;
  /** Keil-style path, already escaped? No: raw path. It is escaped during insertion. */
  path: string;
  fileType: number;
}

export interface GroupAddition {
  groupName: string;
  files: FileToAdd[];
}

export interface AddFilesRequest {
  targetName: string;
  groups: GroupAddition[];
}

export interface TextInsertion {
  offset: number;
  text: string;
  /** Number of original characters to replace. When omitted or 0, the text is inserted. */
  length?: number;
}

export interface AddFilesResult {
  text: string;
  insertions: TextInsertion[];
  groupsCreated: string[];
  filesAdded: number;
}

export interface EncodingCounts {
  utf8: number;
  gb: number;
  neutral: number;
  other: number;
}

export interface EncodingRecommendation {
  charset: SourceCharset;
  source: 'setting' | 'folder' | 'group' | 'project' | 'ask';
  counts: EncodingCounts;
  /** True when the decisive directory/group contains both UTF-8 and GB files. */
  ambiguous: boolean;
  /** True when the recommendation comes from a remembered per-directory choice. */
  fromMemory: boolean;
}

export interface SourceFileSample {
  path: string;
  bytes: Uint8Array;
}
