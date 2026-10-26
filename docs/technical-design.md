# Keil Project Files 技术方案

> 版本：v0.1  
> 对应产品文档：[PRODUCT_DESIGN.md](../PRODUCT_DESIGN.md)  
> 状态：初稿

## 1. 范围与前提

本方案对应产品文档的首版范围：

- 仅支持 Keil MDK5 ARM 工程（`.uvprojx`）；
- 独立 VS Code 扩展，不依赖 Keil Assistant 运行；
- 一次只修改一个当前工程、一个当前 Target；
- 支持新建 `.c` / `.h` 文件；
- 支持多选已有文件加入工程；
- 工程文件编码支持 UTF-8 与 GB2312/GBK；
- 运行平台以本地 Windows 为主。

不在首版范围内：编译/下载/调试、MDK4/C51、文件删除/移动/重命名、文件夹递归添加、Include Path 自动修改。

## 2. 技术栈

| 领域 | 选择 |
|---|---|
| 语言 | TypeScript 5.x（strict） |
| 扩展框架 | VS Code 原生 Extension API |
| UI | QuickPick / InputBox / OpenDialog，不使用 Webview |
| XML 解析 | `saxes`（严格解析 + 字符位置） |
| 字符编码 | `iconv-lite`（GB2312/GBK/GB18030） |
| 工程文件写入 | UTF-8 走 `TextDocument` + `WorkspaceEdit`；GB2312 走字节写入 |
| 原子写入 | `write-file-atomic` |
| 构建 | `esbuild` + `tsc --noEmit` |
| 测试 | Vitest + `@vscode/test-cli` + `@vscode/test-electron` |
| 打包 | `@vscode/vsce` |
| 代码规范 | ESLint + Prettier |

不引入 React/Webview、原生 XML 模块、Python 后端或独立 CLI。

## 3. 总体架构

```text
VS Code Commands / Menus
          │
          ▼
Application（流程编排）
  ├─ ProjectRepository    工程发现、读取、缓存
  ├─ ProjectWriter        编码感知的写入与回滚
  ├─ UiPort               工程/Target/Group/目录/文件名选择
  └─ KeilAssistantAdapter 可选的分组菜单集成（P1）
          │
          ▼
Core（纯 TypeScript，不依赖 vscode）
  ├─ parseProject         解析 + 位置信息
  ├─ addFiles             生成最小插入
  ├─ encoding             编码探测与转换
  ├─ paths                相对路径、去重、转义
  └─ fileTypes            扩展名 → FileType
```

核心原则：

- `core` 不 import `vscode`，可直接用 Vitest 测试；
- 命令层只负责把用户选择转换成 Core 的输入；
- 文件读写、编码、回滚集中在 Adapter，避免散落；
- UI 选择通过 `UiPort` 接口注入，测试时替换为假实现。

## 4. 核心数据模型

```ts
type Charset = 'utf8' | 'utf8bom' | 'gb2312' | 'gbk' | 'gb18030';
type Eol = '\n' | '\r\n';

interface ProjectDocument {
  path: string;          // 绝对路径
  text: string;          // 解码后的文本
  charset: Charset;
  eol: Eol;
  targets: TargetNode[];
}

interface TargetNode {
  name: string;
  groups: GroupNode[];
  targetClose: number;   // </Target> 起始偏移
  groupsClose?: number;  // </Groups> 起始偏移
}

interface GroupNode {
  name: string;
  files: FileNode[];
  groupClose: number;    // </Group> 起始偏移
  filesClose?: number;   // </Files> 起始偏移
}

interface FileNode {
  name: string;
  fileType: number;
  path: string;
}
```

所有偏移都使用 JavaScript/TextDocument 的 UTF-16 code unit 索引，与 `TextDocument.positionAt()` 一致。

## 5. 解析与最小编辑

### 5.1 解析

使用 `saxes` 解析，记录：

- 每个 `<Target>` 的名称、`</Target>` 位置、`</Groups>` 位置；
- 每个 `<Group>` 的名称、`</Group>` 位置、`</Files>` 位置；
- 每个 `<File>` 的 `FileName`、`FileType`、`FilePath`。

处理规则：

- 兼容 `Groups` / `Files` 缺失的情况；
- 不依赖固定缩进、换行符或路径风格；
- 保留 XML 声明、注释、`<RTE>` 等未涉及内容；
- 解析失败时直接报错，不尝试“修复”。

### 5.2 插入位置

在目标 Group 中插入文件：

- 有 `<Files>`：插入到 `</Files>` 前；
- 无 `<Files>`：在 `</Group>` 前创建 `<Files>` 块；
- 目标 Group 不存在：在 `</Groups>` 前创建 `<Group>`；若整个 `<Groups>` 不存在，则在 `</Target>` 前创建。

插入文本使用检测到的缩进和换行符，例如：

```xml
<File>
  <FileName>app.c</FileName>
  <FileType>1</FileType>
  <FilePath>.\App\app.c</FilePath>
</File>
```

### 5.3 校验

写入前先在内存中生成完整新文本，并校验：

1. `newText` 能被 `saxes` 重新解析；
2. Target / Group / File 的语义快照符合预期；
3. 原有文件条目一个不少；
4. 除插入点外，前后文本保持不变；
5. 目标 Group 内没有重复路径。

写入后再从磁盘读回并重复校验，失败则用备份恢复。

## 6. 编码支持（重点）

### 6.1 探测顺序

1. 检测 BOM：UTF-8 BOM 标记为 `utf8bom`；UTF-16 首版明确拒绝。
2. 读取 XML 声明中的 `encoding`。
3. 声明为 UTF-8：用 `TextDecoder('utf-8', { fatal: true })` 验证；失败则报“声明与实际编码不一致”。
4. 声明为 GB2312/GBK/GB18030：用 `iconv-lite` 解码。
5. 无声明：先尝试严格 UTF-8，失败后按 GB18030 解码。
6. 记录原编码、BOM、换行符和缩进，写回时保持。

写回 GB2312 前做一次 `encode → decode` 对比；如果字符无法用目标编码表示，直接中止，避免静默替换成 `?`。

### 6.2 写入策略

VS Code 的 `TextDocument` / `WorkspaceEdit` 不提供可靠的“按文件指定编码”能力，文档编码由 VS Code 自己判断。直接对 GB2312 文件使用 `WorkspaceEdit` 保存，存在被转成 UTF-8 或中文乱码的风险。

因此采用混合写入：

| 工程文件编码 | 写入方式 | 说明 |
|---|---|---|
| UTF-8 / UTF-8 BOM | `TextDocument` + `WorkspaceEdit` + save | 支持撤销；需处理已打开、未保存的文档 |
| GB2312 / GBK / GB18030 | `iconv-lite` + `write-file-atomic` | 保证字节编码不变；要求文件未在编辑器中打开 |

两种方式共用同一套解析、编辑、校验和备份逻辑，只是最后的落盘方式不同。

GB2312 文件如果已经在 VS Code 中打开，首版直接提示用户关闭后重试，不尝试自动关闭或强制转码。这样行为可预期，也不会破坏用户未保存的内容。

### 6.3 新建源文件编码

- 设置项 `keilProject.newFileEncoding`：`auto` / `utf8` / `gb2312`，默认 `auto`；
- `auto` 表示跟随当前工程文件编码；
- 新文件默认无 BOM，换行符跟随工程或 `files.eol`；
- 编码失败时中止并给出明确错误，不写入半成品文件。

## 7. 写入流程与安全

### 7.1 UTF-8 写入流程

1. 读取文件，探测编码，解析工程。
2. 确认文档未处于 dirty 状态；如果已打开且未保存，提示先保存或中止。
3. 在内存中生成新文本并完成校验。
4. 备份原文件到扩展的 `globalStorageUri`。
5. 计算最小插入位置，通过 `WorkspaceEdit` 插入。
6. 保存文档。
7. 重新读取并解析；失败则恢复备份。

### 7.2 GB2312 写入流程

1. 读取字节，`iconv-lite` 解码并解析。
2. 如果文件已在 VS Code 中打开，提示关闭后重试。
3. 生成新文本、校验、备份。
4. 编码回原字符集，做 round-trip 校验。
5. `write-file-atomic` 原子写入。
6. 重新读取并解析；失败则恢复备份。

### 7.3 并发与冲突

- 写入前比较文件 hash 与 mtime；发现外部修改则中止。
- 遇到 `EBUSY` / `EPERM` 重试 3 次，每次间隔约 200ms；仍失败则提示关闭 Keil。
- 备份保留最近若干份，放在扩展全局存储，不污染用户工程目录。
- 不在用户工程中自动执行 `git commit`。
- 修改成功后提示：如果 Keil 正打开该工程，需要重新加载。

## 8. 路径与文件规则

- 路径相对于 `.uvprojx` 所在目录计算，使用 `path.win32`。
- 同一目录或子目录统一为 `.\App\main.c` 风格；不同盘符保留绝对路径并提示。
- 路径和文件名做 XML 转义。
- 去重基于规范化绝对路径；Windows 下忽略大小写和斜杠差异。
- 新建文件前检查同名文件、非法字符和 Windows 保留名。
- 新建文件失败时，如果已经创建了物理文件，需要回滚删除。
- 添加已有文件只建立工程引用，不复制、不移动。
- `.h` 加入工程不会自动加入 Include Path；首版只做提示。

## 9. 命令与交互

| 命令 | 用途 |
|---|---|
| `keilProject.addNewC` | 新建 C 文件并加入工程 |
| `keilProject.addNewH` | 新建 H 文件并加入工程 |
| `keilProject.addExistingFiles` | 多选已有文件加入工程 |
| `keilProject.selectProject` | 手动选择当前工程 |
| `keilProject.createGroup` | 新建 Group（可被选择器复用） |

入口：

- 资源管理器文件夹右键：新建 C/H；
- 资源管理器文件多选右键：添加已有文件；
- 命令面板；
- Keil Assistant 分组右键（P1）。

流程使用原生 QuickPick / InputBox 分步完成；当前工程、Target、最近使用目录保存在 `workspaceState`。

## 10. Keil Assistant 集成（P1）

- 检查扩展是否安装，不形成硬依赖；
- 向视图 ID `project` 的 `FileGroup` 节点贡献右键菜单；
- 通过节点上的 `label`、`prjID` 等信息映射工程与分组，做 feature-detect；
- 接口变化时自动降级到命令面板/资源管理器流程；
- Keil Assistant 监听工程文件变化，写入成功后通常会自动刷新；
- 多 Target 时如果无法确定当前 Target，弹出选择。

## 11. 测试方案

### 11.1 单元测试（Vitest）

- XML 解析：Target/Group/File 模型、缺失 `Groups`/`Files`、多 Target；
- 最小插入：新增文件、创建 Group、创建 Files；
- Golden test：修改后除新增行外字节不变；
- 路径：相对路径、`..`、空格、中文、`&`、大小写去重；
- 编码：UTF-8、UTF-8 BOM、GB2312、GBK、CRLF/LF；
- GB2312 round-trip 与不可表示字符；
- 错误场景：重复文件、非法 XML、外部修改、文件被占用。

### 11.2 集成测试（VS Code Test CLI）

- 新建 C/H 的完整命令流程；
- 多选已有文件；
- WorkspaceEdit 保存与撤销；
- GB2312 文件写入与 Keil Assistant 刷新；
- 临时工作区 + 最小 `.uvprojx` fixture。

### 11.3 真实工程验证

- 开发阶段扫描本机 `D:\Keil5` 下的工程做只读解析，不提交这些工程；
- 手工在 Keil 中打开修改后的工程，确认文件和分组出现、编译通过；
- 重点验证 GB2312 中文路径/文件名、Keil 正打开工程、多 Target、UTF-8 BOM。

CI 至少运行 lint、类型检查、单元测试和打包；集成测试在 Windows runner 上运行。

## 12. 工程结构

```text
src/
  extension.ts
  commands/
    addNewFile.ts
    addExistingFiles.ts
    selectProject.ts
  core/
    model.ts
    parseProject.ts
    addFiles.ts
    encoding.ts
    paths.ts
    fileTypes.ts
    templates.ts
    validate.ts
  adapters/
    projectRepository.ts
    projectWriter.ts
    ui.ts
    keilAssistant.ts
  i18n/
test/
  core/
  integration/
  fixtures/
docs/
  technical-design.md
```

## 13. 构建与发布

- `esbuild` 输出 CommonJS 到 `dist/extension.js`，`vscode` 设为 external；
- `tsc --noEmit` 做类型检查；
- `@vscode/vsce` 打包 VSIX，`.vscodeignore` 排除源码和测试；
- `engines.vscode` 对齐使用的 API，Node 目标与 VS Code 内置 Node 一致；
- 先本地 VSIX 验证，再考虑 Marketplace 和 Open VSX；
- 不联网、不收集遥测。

## 14. 里程碑

| 阶段 | 内容 |
|---|---|
| M0 | Spike：解析真实工程，插入 UTF-8/GB2312 文件，Keil 打开验证 |
| M1 | 核心解析/编辑/编码 + 新建 C/H + 单元测试 |
| M2 | 添加已有文件、去重、Group 创建、WorkspaceEdit/字节写入 |
| M3 | 安全加固、Keil Assistant 菜单、集成测试、文档、VSIX |

## 15. 风险与待定

| 风险 | 应对 |
|---|---|
| GB2312 文件在编辑器中打开导致保存乱码 | 首版要求关闭后写入；写入前 round-trip 校验 |
| Keil 占用工程文件 | 重试、hash 校验、提示重新加载 |
| 不同工程格式差异 | 真实工程测试 + 最小插入 + 写后校验 |
| BOM/换行符被改变 | 写后重新读取并比对元数据 |
| Keil Assistant 内部接口变化 | 仅作为 P1 增强，失败自动降级 |

待定：

- 备份保留数量与默认值；
- 是否在首版提供“同时创建同名 H 文件”的默认勾选；
- Marketplace / Open VSX 发布节奏。
