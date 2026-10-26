# Keil Project Files

在 VS Code 中完成 Keil MDK5 ARM 工程的三件事：

1. 新建 `.c` / `.h` 文件；
2. 把新文件或已有文件加入指定 Target / Group；
3. 让文件在 Keil Assistant 和 Keil 工程树中可见。

本扩展只负责“建文件 + 写工程 + 让文件可见”，**不做**编译、下载、调试、代码编辑、Include Path 维护、文件删除/移动/重命名。

## 功能

- 在资源管理器文件夹右键新建 Keil C/H 文件，或从命令面板执行；
- 左侧活动栏提供 **Keil 工程文件** 快捷操作面板，可在不打开目标文件夹的情况下启动新建/添加流程；
- 多选已有文件，一次加入当前 Target 的指定 Group；
- 自动扫描工作区 `.uvprojx`，多工程时记住当前工程；
- 单 Target 自动选择，多 Target 记住上次选择，一次只修改一个 Target；
- 支持新建 Group，Group 是 Keil 虚拟分组，不推断磁盘目录；
- 支持工程目录之外的源文件：同盘写入 `..\` 相对路径，跨盘符使用绝对路径并提示；
- 同一 Target 内按规范化绝对路径去重，Windows 下忽略大小写和斜杠差异；
- 工程文件支持 UTF-8、UTF-8 BOM、GB2312、GBK、GB18030，写回保持原编码；
- 新源文件支持 UTF-8 或 GB2312/GBK，默认根据目标目录、Group、工程的多数编码推断；
- 最小 XML 文本插入，保留原格式、缩进、换行符、注释和未涉及内容；
- 写前 hash 校验、写后重新解析校验、失败自动恢复、可选备份；
- 不联网、不收集遥测。

## 使用

### 左侧快捷操作面板

活动栏新增 **Keil 工程文件** 图标，点击后显示：

- 当前工程和上次使用的 Target；
- 新建 Keil C / H 文件；
- 添加已有文件；
- 新建 Group；
- 选择当前工程。

它只是命令入口和状态面板，**不是第二个工程树**，不会复制或替代资源管理器。

当目标目录（例如 `HARDWARE`）不在资源管理器中时，可以从这里点击 **新建 Keil C 文件**，在目录选择步骤选择 **选择其他目录…**，直接定位到工程外的文件夹。

面板标题栏还提供新建 C 文件、添加已有文件、选择工程和刷新按钮。

### 新建 C / H 文件

1. 在资源管理器中右键目标文件夹，选择 **新建 Keil C 文件** 或 **新建 Keil H 文件**；
2. 确认当前工程、Target、Group（可现场创建 Group）；
3. 确认目录、文件名和编码；
4. 文件创建成功后写入 `.uvprojx`。

UTF-8 文件可直接打开；GB2312/GBK 文件默认不自动打开，编辑前请使用 VS Code 的 **Reopen with Encoding** 选择 `GBK` 或 `GB18030`。

### 工程目录外的文件

文件所在磁盘目录与 Keil Group 是两件独立的事：

- **目录** 决定源文件实际创建/引用在哪里；
- **Group** 只是 `.uvprojx` 中的虚拟分组，不会创建或改变磁盘目录。

因此可以把文件放在工程文件所在目录之外。例如：

```text
D:\MyProject\
  MDK-ARM\
    MyProject.uvprojx
  HARDWARE\
    led.c
```

在 `HARDWARE` 中新建 `led.c` 并选择/创建 Keil Group `HARDWARE` 后，写入的条目是：

```xml
<FilePath>..\HARDWARE\led.c</FilePath>
```

操作方式：

1. 如果 `HARDWARE` 与工程目录同在 VS Code 工作区内，直接右键 `HARDWARE` 文件夹新建文件；
2. 如果 `HARDWARE` 不在当前工作区，可执行命令面板中的新建命令，在“选择新文件所在目录”步骤选择 **选择其他目录…** 定位到该文件夹；
3. 也可以在 VS Code 中使用 **File: Add Folder to Workspace** 把 `HARDWARE` 加入工作区后再右键。

同盘目录使用 `..\` 相对路径；不同盘符会写入绝对路径并给出提示。工程外的头文件不会自动加入 Include Path，需要在 Keil 中手动添加例如 `..\HARDWARE`。

### 添加已有文件

1. 在资源管理器中多选文件，右键选择 **添加到 Keil 工程**；
2. 确认工程、Target、Group；
3. 查看将添加 / 将跳过的文件清单；
4. 一次写入工程。

只建立工程引用，不复制、不移动、不转码已有文件。文件夹递归添加不在本版范围。

### 其他命令

- `Keil Project Files: 选择当前 Keil 工程`
- `Keil Project Files: 新建 Keil Group`

## 设置

| 设置                            | 默认值      | 说明                                                                      |
| ------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `keilProject.projectFile`       | 空（自动）  | 手动指定 `.uvprojx`。相对路径基于第一个工作区目录。设置后优先于自动发现。 |
| `keilProject.newFileEncoding`   | `auto`      | `auto` / `utf8` / `gb2312`。`auto` 按目录 > Group > 工程的多数编码推断。  |
| `keilProject.autoOpenNewFile`   | `utf8-only` | `always` / `never` / `utf8-only`。GB2312 文件建议保持不自动打开。         |
| `keilProject.backupProjectFile` | `true`      | 修改前把原工程备份到扩展全局存储，保留最近 20 份。                        |
| `keilProject.template.c`        | 空（内置）  | C 文件模板，支持 `${filename}`、`${basename}`、`${date}`、`${year}`。     |
| `keilProject.template.h`        | 空（内置）  | H 文件模板，额外支持 `${includeGuard}`。                                  |

## 编码说明

工程文件编码与源文件编码相互独立：

- 工程文件编码由 `.uvprojx` 自身决定，写回时保持不变；
- 新源文件编码根据目标目录/Group 中已有 `.c/.h` 推断，不跟随工程文件；
- 纯 ASCII 文件不参与编码投票；
- 同时可被 UTF-8 和 GBK 解码的文件按 UTF-8 处理；
- 混合编码目录会展示统计并要求确认，选择会按目录记住；
- 已有源文件永远不转码。

## 可见性

扩展只写入标准 `<File>` / `<Group>` / `<Files>` 条目。Keil Assistant 和 Keil 会自行解析工程文件：

- Keil Assistant 通常监听 `.uvprojx` 变化并自动刷新；如未刷新，重新打开工程；
- Keil Assistant 只显示当前 Target，文件加到其他 Target 时需要切换 Target；
- 如果 Keil 正打开该工程，修改后请在 Keil 中重新加载工程文件。

头文件加入工程不会自动加入 Include Path，编译时如找不到头文件需要手动配置。

## 已知边界

- 仅支持 Keil MDK5 ARM `.uvprojx`；不支持 `.uvproj`、C51、`.uv2`；
- 不修改 `.uvoptx`；
- 不支持文件夹递归添加；
- 一次只修改一个工程、一个 Target；
- 不自动结束 Keil 进程，不自动执行 `git commit`。

## 开发

```bash
npm install
npm run check        # TypeScript 类型检查
npm run lint         # ESLint
npm test             # Vitest 单元测试
npm run test:integration  # VS Code 集成测试（首次会下载 VS Code）
npm run package      # 生成 VSIX
```

产品需求与技术方案见仓库中的 `PRODUCT_DESIGN.md` 和 `docs/technical-design.md`。

## License

MIT
