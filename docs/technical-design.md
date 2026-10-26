# Keil Project Files 技术方案

> 版本：v1.0  
> 对应产品文档：[PRODUCT_DESIGN.md](../PRODUCT_DESIGN.md)  
> 状态：范围已确认，待实现

## 1. 范围与前提

本方案严格对应产品范围，只做三件事：

1. 新建 `.c` / `.h` 文件；
2. 把新文件或已有文件加入 `.uvprojx` 的指定 Target / Group；
3. 让文件在 Keil Assistant 和 Keil 工程树中可见。

明确不做：编译、下载、调试、源代码编辑/重构、Include Path 维护、文件删除/移动/重命名、工程树、文件夹递归添加、多 Target 批量修改、Keil Assistant 深度集成。

技术前提：

- Keil MDK5 ARM `.uvprojx`；
- 独立 VS Code 扩展；
- 一次只修改一个当前工程、一个 Target；
- 工程文件和新源文件均支持 UTF-8 与 GB2312/GBK；
- 运行平台以本地 Windows 为主。

## 2. 技术栈

| 领域 | 选择 |
|---|---|
| 语言 | TypeScript 5.x（strict） |
| 扩展框架 | VS Code 原生 Extension API |
| UI | QuickPick / InputBox / OpenDialog，不使用 Webview |
| XML 解析 | `saxes`（严格解析 + 字符位置） |
| 工程文件编码 | `iconv-lite` |
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
  ├─ ProjectWriter        编码感知的工程文件写入与回滚
  ├─ SourceFileService    新源文件编码与落盘
  └─ UiPort               工程/Target/Group/目录/文件名/编码选择
          │
          ▼
Core（纯 TypeScript，不依赖 vscode）
  ├─ parseProject         解析 + 位置信息
  ├─ addFiles             生成最小插入
  ├─ encoding             工程文件编码探测与转换
  ├─ sourceEncoding       源文件编码统计与推荐
  ├─ paths                相对路径、去重、转义
  └─ fileTypes            扩展名 → FileType
```

核心原则：

- `core` 不 import `vscode`，可直接用 Vitest 测试；
- 命令层只负责把用户选择转换成 Core 的输入；
- 文件读写、编码、回滚集中在 Adapter；
- UI 选择通过 `UiPort` 注入，测试时替换为假实现；
- 不依赖 Keil Assistant 的任何内部对象或接口。

## 4. 核心数据模型

```ts
type ProjectCharset = 'utf8' | 'utf8bom' | 'gb2312' | 'gbk' | 'gb18030';
type SourceCharset = 'utf8' | 'gb2312' | 'gbk';
type Eol = '\n' | '\r\n';

interface ProjectDocument {
  path: string;          // 绝对路径
  text: string;          // 解码后的文本
  charset: ProjectCharset;
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

interface EncodingRecommendation {
  charset: SourceCharset;
  source: 'setting' | 'folder' | 'group' | 'project' | 'ask';
  counts: { utf8: number; gb: number; neutral: number };
}
```

所有偏移使用 JavaScript/TextDocument 的 UTF-16 code unit 索引，与 `TextDocument.positionAt()` 一致。

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

## 6. 编码支持

### 6.1 工程文件与源文件是两条独立链路

- `.uvprojx` 的编码由工程文件自身决定；
- 源文件的编码由目标目录/Group 的既有文件决定；
- 两者不能互相推断；
- 已有源文件永远不转码。

### 6.2 工程文件写入

VS Code 的 `TextDocument` / `WorkspaceEdit` 不提供可靠的“按文件指定编码”能力。对 GB2312 文件直接使用 `WorkspaceEdit` 保存，存在被转成 UTF-8 或中文乱码的风险。

采用混合写入：

| 工程文件编码 | 写入方式 | 说明 |
|---|---|---|
| UTF-8 / UTF-8 BOM | `TextDocument` + `WorkspaceEdit` + save | 支持撤销；处理已打开、未保存的文档 |
| GB2312 / GBK / GB18030 | `iconv-lite` + `write-file-atomic` | 保证字节编码不变；要求文件未在编辑器中打开 |

两种方式共用同一套解析、编辑、校验和备份逻辑。

工程文件编码探测顺序：

1. BOM：UTF-8 BOM → `utf8bom`；UTF-16 明确拒绝；
2. XML 声明中的 `encoding`；
3. UTF-8 严格校验；
4. GB2312/GBK/GB18030 解码；
5. 声明与实际字节不一致时中止并报错，不做自动修复。

### 6.3 新源文件编码推荐

`keilProject.newFileEncoding = auto` 时按以下优先级：

1. 用户显式设置；
2. 目标目录中已有 `.c/.h` 的多数编码；
3. 目标 Group 中已有 `.c/.h` 的多数编码；
4. 整个工程源文件的多数编码；
5. 无法判断时询问用户。

规则：

- 纯 ASCII 文件编码中性，不参与投票；
- Windows-1252 等“其他编码”不参与投票；
- 同一目录下 UTF-8 与 GB2312 混合时，展示统计并让用户确认；
- 记住每个目录的选择；
- `.c` 和同名 `.h` 使用同一种编码；
- 新建编码确认步骤显示在创建流程中，用户可覆盖推荐值。

### 6.4 纯英文与 BOM

- ASCII 是 UTF-8 与 GB2312/GBK 的公共子集，纯英文内容在两种编码下字节一致；
- 纯英文 `.c/.h` 和纯英文 XML 内容不受编码选择影响；
- 只要后续加入中文，编码才有实际区别；
- UTF-8 BOM 是例外：带 BOM 的文件开头为 `EF BB BF`，必须按 UTF-8 处理并保留 BOM；
- 新建纯英文文件默认不写 BOM。

### 6.5 VS Code 编辑器编码

VS Code 默认按 UTF-8 打开，`files.autoGuessEncoding` 默认关闭。扩展 API 没有稳定接口给单个文件指定编码。

产品行为：

- 新建 UTF-8 文件可以自动打开；
- 新建 GB2312 文件默认不自动打开（`autoOpenNewFile = utf8-only`）；
- 提示用户编辑前使用 “Reopen with Encoding” 选择 GBK/GB18030；
- 不在乱码状态下保存 GB2312 文件；
- 不自动修改用户的 `files.encoding` 或 `files.autoGuessEncoding`；
- 不尝试调用内部命令强制设置编码。

插件只保证磁盘字节正确；编辑器显示编码由用户和 VS Code 设置决定。

### 6.6 真实工程参考

对若干真实 MDK5 工程的只读扫描统计结果（示例）：

| 类型 | 典型占比 |
|---|---:|
| 源文件总数（`.c/.h/.cpp/.s/.asm`） | 数百个 |
| 纯 ASCII | 大多数 |
| GB2312 / GBK | 少量到中等 |
| UTF-8 | 少量 |
| Windows-1252 / 其他 | 极少量 |

结论：

- 常见 `.uvprojx` 声明 UTF-8，内容常为纯 ASCII；
- 非 ASCII 源文件中 GB2312 / GBK 往往占多数，但个别目录可能以 UTF-8 为主；
- 同一个工程内必须按目录/Group 推断源文件编码，不能跟随工程文件编码；
- 检测必须以 UTF-8 优先，不能因为“GBK 能解码”就判定为 GBK；
- Windows-1252 等第三方文件应排除在投票之外，且永远不转码。

## 7. 写入流程与安全

### 7.1 UTF-8 工程文件

1. 读取文件，探测编码，解析工程。
2. 如果文档已打开且 dirty，提示先保存或中止。
3. 在内存中生成新文本并完成校验。
4. 备份原文件到 `globalStorageUri`。
5. 通过 `WorkspaceEdit` 做最小插入并保存。
6. 重新读取并解析；失败则恢复备份。

### 7.2 GB2312 工程文件

1. 读取字节，`iconv-lite` 解码并解析。
2. 如果文件已在 VS Code 中打开，提示关闭后重试。
3. 生成新文本、校验、备份。
4. 编码回原字符集，做 round-trip 校验。
5. `write-file-atomic` 原子写入。
6. 重新读取并解析；失败则恢复备份。

### 7.3 新建源文件

1. 根据目录/Group 统计得到推荐编码，用户确认。
2. 用模板生成文本。
3. 用目标编码编码为字节，使用 `workspace.fs.writeFile` 写入。
4. 重新读取并解码，确认内容一致。
5. 更新 `.uvprojx`；如果工程更新失败，删除刚创建的文件。
6. 根据 `autoOpenNewFile` 决定是否打开。

### 7.4 并发与冲突

- 写入前比较文件 hash 与 mtime；发现外部修改则中止。
- 遇到 `EBUSY` / `EPERM` 重试 3 次，每次约 200ms；仍失败则提示关闭 Keil。
- 备份保留最近若干份，放在扩展全局存储，不污染用户工程目录。
- 不在用户工程中自动执行 `git commit`。
- 修改成功后提示：如果 Keil 正打开该工程，需要重新加载。

## 8. 路径与文件规则

- 路径相对于 `.uvprojx` 所在目录计算，使用 `path.win32`。
- 同一目录或子目录统一为 `.\App\main.c` 风格；不同盘符保留绝对路径并提示。
- 路径和文件名做 XML 转义。
- 去重基于规范化绝对路径；Windows 下忽略大小写和斜杠差异。
- 新建文件前检查同名文件、非法字符和 Windows 保留名。
- 添加已有文件只建立工程引用，不复制、不移动、不转码。
- 文件扩展名映射：

| 扩展名 | FileType |
|---|---:|
| `.c` | 1 |
| `.s` / `.asm` | 2 |
| `.lib` | 4 |
| `.h` / `.txt` | 5 |
| `.cpp` | 8 |

- `.h` 加入工程不会自动加入 Include Path；本插件不修改 Include Path。

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
- 不新增独立工程树，不向 Keil Assistant 添加菜单。

流程使用原生 QuickPick / InputBox 分步完成；当前工程、Target、最近使用目录和目录编码选择保存在 `workspaceState`。

## 10. 可见性

- 插件只写入标准 `<File>` / `<Group>` 条目；
- Keil Assistant 和 Keil 自行解析 `.uvprojx`，不依赖插件刷新；
- Keil Assistant 监听工程文件变化，通常会自动刷新；
- 它只显示当前 Target，文件加到其他 Target 时需要切换；
- 如果未刷新，重新打开工程即可；
- 插件只保证文件存在、路径正确、条目合法；编译和下载由 Keil Assistant / Keil 负责。

## 11. 测试方案

### 11.1 单元测试（Vitest）

- XML 解析：Target/Group/File 模型、缺失 `Groups`/`Files`、多 Target；
- 最小插入：新增文件、创建 Group、创建 Files；
- Golden test：修改后除新增行外字节不变；
- 路径：相对路径、`..`、空格、中文、`&`、大小写去重；
- 编码：UTF-8、UTF-8 BOM、GB2312、GBK、CRLF/LF；
- 纯 ASCII 文件不参与编码投票；
- 混合目录编码推荐；
- 双重可解码文件的 UTF-8 优先判断；
- Windows-1252 / 未知编码文件排除；
- GB2312 round-trip 与不可表示字符；
- 错误场景：重复文件、非法 XML、外部修改、文件被占用。

### 11.2 集成测试（VS Code Test CLI）

- 新建 C/H 的完整命令流程；
- 多选已有文件；
- UTF-8 工程文件 WorkspaceEdit 保存；
- GB2312 工程文件字节写入；
- GB2312 新文件不自动打开；
- 工程更新失败时删除刚创建的文件；
- 临时工作区 + 最小 `.uvprojx` fixture。

### 11.3 真实工程验证

- 开发阶段扫描本机 `D:\Keil5` 下的工程做只读解析，不提交这些工程；
- 手工在 Keil 中打开修改后的工程，确认文件和分组出现；
- 在 Keil Assistant 中切换 Target，确认文件可见；
- 重点验证 GB2312 中文路径/文件名、Keil 正打开工程、多 Target、UTF-8 BOM、纯英文工程。

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
    sourceEncoding.ts
    paths.ts
    fileTypes.ts
    templates.ts
    validate.ts
  adapters/
    projectRepository.ts
    projectWriter.ts
    ui.ts
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
| M0 | Spike：解析真实工程，插入 UTF-8/GB2312 文件，Keil 和 Keil Assistant 可见 |
| M1 | 核心解析/编辑/编码 + 新建 C/H + 单元测试 |
| M2 | 添加已有文件、去重、Group 创建、编码推荐与选择 |
| M3 | 安全加固、集成测试、文档、VSIX |

## 15. 风险与待定

| 风险 | 应对 |
|---|---|
| Keil 占用工程文件 | 重试、hash 校验、提示重新加载 |
| GB2312 文件在编辑器中误保存 | 默认不自动打开；提示手动 Reopen；不做自动转码 |
| 混合编码目录判断错误 | 展示统计；用户确认；记住选择 |
| 不同工程格式差异 | 真实工程测试 + 最小插入 + 写后校验 |
| BOM/换行符被改变 | 写后重新读取并比对元数据 |
| Keil Assistant 未刷新或 Target 不同 | 切换 Target 或重新打开工程；不作为插件故障 |
| 用户期待编译/编辑功能 | 明确产品边界：只做建文件和加工程 |

待定：

- 备份保留数量与默认值；
- 是否在首版提供“同时创建同名 H 文件”的默认勾选；
- 英文界面和 Marketplace / Open VSX 发布节奏。
