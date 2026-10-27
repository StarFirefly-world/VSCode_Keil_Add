# Keil Project Files

> English: A VS Code extension for Keil MDK5 ARM projects. Create `.c` / `.h` files, add existing files, and insert them into the correct Target / Group of `.uvprojx` — without leaving VS Code.

在 VS Code 中完成 Keil MDK5 ARM 工程的三件事：

1. 新建 `.c` / `.h` 文件；
2. 把新文件或已有文件加入指定 Target / Group；
3. 让文件在 Keil Assistant 和 Keil 工程树中可见。

本扩展只负责“建文件 + 写工程 + 让文件可见”，**不做**编译、下载、调试、代码编辑、Include Path 维护；除受控的“删除模块”外，也不做任意文件删除、移动或重命名。

## 安装

### 方式一：从 VSIX 安装（推荐）

1. 下载本仓库 Releases 中的 `keil-project-files-*.vsix`；
2. 在 VS Code 中按 `Ctrl+Shift+P`（macOS `Cmd+Shift+P`），输入并选择 **Extensions: Install from VSIX...**；
3. 选择下载的 `.vsix` 文件即可。

### 方式二：从源码运行

```bash
git clone https://github.com/StarFirefly-world/VSCode_Keil_Add.git
cd VSCode_Keil_Add
npm install
npm run compile
```

然后按 `F5` 启动扩展开发宿主，或运行 `npm run package` 生成 VSIX。

## 快速开始

1. 用 VS Code 打开包含 `.uvprojx` 的工作区；
2. 点击左侧活动栏的 **Keil 工程文件** 图标；
3. 选择 **选择当前工程…**，插件会自动扫描工作区内的 `.uvprojx`；
4. 点击 **新建 Keil C 文件** / **添加已有文件…** 等命令，按提示选择 Target、Group、目录和编码；
5. 完成后在 Keil Assistant 或 Keil 中切换/刷新 Target，即可看到新增文件。

## 功能

- 从左侧活动栏 **Keil 工程文件** 面板或命令面板新建 Keil C/H 文件；
- 左侧活动栏提供快捷操作面板，可在不打开目标文件夹的情况下启动新建/添加流程；
- 可为当前工程设置“总工程文件夹”，作为目录选择器的工程根目录和默认回退，并支持恢复自动推断；
- 添加模块：在指定父目录下生成 `<模块名>/<模块名>.c` 和 `<模块名>.h`，只把 `.c` 加入所选 Group；支持工程目录外和其他盘符；
- 删除模块：删除模块文件夹及磁盘文件，并从 `.uvprojx` 的所有 Target / Group 中移除该模块目录的 `<File>` 条目；
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
- 总工程文件夹（点击可设置或恢复自动推断）；
- 新建 Keil C / H 文件；
- 添加已有文件；
- 新建 Group；
- 添加模块；
- 删除模块；
- 选择当前工程。

它只是命令入口和状态面板，**不是第二个工程树**，不会复制或替代资源管理器。

当目标目录（例如 `HARDWARE`）不在资源管理器中时，可以从这里点击 **新建 Keil C 文件**，在目录选择步骤选择 **选择其他目录…**，直接定位到工程外的文件夹。

面板标题栏还提供新建 C 文件、添加已有文件、选择工程和刷新按钮。

### 设置总工程文件夹

如果自动推断的总工程文件夹不正确，或目录选择器总是从错误的位置开始：

1. 点击左侧面板中的 **总工程文件夹**；
2. 选择 **选择总工程文件夹…**；
3. 在文件夹对话框中选择实际的总工程目录；
4. 设置后，新建文件/模块时目录选择器的“工程根目录”和默认回退会使用该目录。

该项按当前工程保存在 VS Code 的 workspaceState 中，不会修改 `settings.json`，也不会改写 `.uvprojx` 中已有的源文件路径。

需要恢复自动推断时，再次点击 **总工程文件夹**，选择 **恢复自动推断**。

### 新建 C / H 文件

1. 点击左侧 **Keil 工程文件** 图标，选择 **新建 Keil C 文件** 或 **新建 Keil H 文件**；
2. 确认当前工程、Target、Group（可现场创建 Group）；
3. 选择目录，输入文件名和编码；
4. 文件创建成功后写入 `.uvprojx`。

UTF-8 文件可直接打开；GB2312/GBK 文件默认不自动打开，编辑前请使用 VS Code 的 **Reopen with Encoding** 选择 `GBK` 或 `GB18030`。

### 添加模块

执行 **Keil Project Files: 添加 Keil 模块**，或使用左侧快捷面板。

流程会分别选择：

1. Target；
2. **Keil Group**（可以是已有或新建 Group）；
3. **模块父文件夹**（磁盘目录，与 Group 无关）；
4. 模块名；
5. 编码。

例如父文件夹选择 `HARDWARE`，模块名输入 `motor`，会生成：

```text
HARDWARE/
  motor/
    motor.c
    motor.h
```

`motor.h` 内容为：

```c
#ifndef _MOTOR_H
#define _MOTOR_H
#endif
```

`motor.c` 默认只包含：

```c
#include "motor.h"
```

只有 `motor.c` 会加入前面选择的 Group；`motor.h` 只存在于磁盘，不会加入工程，也不会修改 Include Path。

模块父文件夹可以任意选择，包括 `.uvprojx` 所在目录之外，甚至其他盘符：

- 同一盘符：工程中写入 `..\` 相对路径；
- 不同盘符：工程中写入绝对路径，并提示该路径不可随工程移动；
- 选择工程目录外时，插件会给出提示，但不会阻止创建。

> `.uvprojx` 没有显式的“总工程目录”字段；目录选择器中的“工程根目录”快捷项由 VS Code 工作区与 `.uvprojx` 所在位置推断。

### 删除模块

执行 **Keil Project Files: 删除 Keil 模块**，或使用左侧快捷面板。

1. 从工程中检测到的模块列表里选择，或选择 **选择其他模块文件夹…** 手动定位；
2. 确认窗口会列出将删除的磁盘文件和将移除的工程条目；
3. 点击 **删除模块** 后：
   - 递归删除模块文件夹及其中所有文件；
   - 从 `.uvprojx` 的所有 Target / Group 中删除指向该目录的 `<File>` 条目；
   - 保留原有 Group（可能变为空 Group）。

选择其他文件夹时，插件只接受包含同名 `.c` 或 `.h` 的模块文件夹，例如 `motor/motor.c`，避免误删普通目录。

> 删除文件夹不可撤销；工程文件修改前仍会按 `keilProject.backupProjectFile` 设置备份。Group、Include Path 不会被自动清理。

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

1. 从左侧快捷面板或命令面板执行新建命令；
2. 在“选择新文件所在目录”步骤选择 **选择其他目录…**，直接定位到工作区外的文件夹；
3. 如果常用该目录，也可以使用 **File: Add Folder to Workspace** 将它加入工作区。

同盘目录使用 `..\` 相对路径；不同盘符会写入绝对路径并给出提示。工程外的头文件不会自动加入 Include Path，需要在 Keil 中手动添加例如 `..\HARDWARE`。

### 添加已有文件

1. 点击左侧 **Keil 工程文件** 图标，选择 **添加已有文件…**，或从命令面板执行 **添加到 Keil 工程**；
2. 在文件选择对话框中多选文件；
3. 确认工程、Target、Group；
4. 查看将添加 / 将跳过的文件清单；
5. 一次写入工程。

只建立工程引用，不复制、不移动、不转码已有文件。文件夹递归添加不在本版范围。

### 其他命令

- `Keil Project Files: 新建 Keil C 文件`
- `Keil Project Files: 新建 Keil H 文件`
- `Keil Project Files: 添加到 Keil 工程`
- `Keil Project Files: 选择当前 Keil 工程`
- `Keil Project Files: 新建 Keil Group`
- `Keil Project Files: 添加 Keil 模块`
- `Keil Project Files: 删除 Keil 模块`
- `Keil Project Files: 设置总工程文件夹`

## 设置

| 设置                            | 默认值      | 说明                                                                      |
| ------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `keilProject.projectFile`       | 空（自动）  | 手动指定 `.uvprojx`。相对路径基于第一个工作区目录。设置后优先于自动发现。 |
| `keilProject.newFileEncoding`   | `auto`      | `auto` / `utf8` / `gb2312`。`auto` 按目录 > Group > 工程的多数编码推断。  |
| `keilProject.autoOpenNewFile`   | `utf8-only` | `always` / `never` / `utf8-only`。GB2312 文件建议保持不自动打开。         |
| `keilProject.backupProjectFile` | `true`      | 修改前把原工程备份到扩展全局存储，保留最近 20 份。                        |
| `keilProject.template.c`        | 空（内置）  | C 文件模板，支持 `${filename}`、`${basename}`、`${date}`、`${year}`。     |
| `keilProject.template.h`        | 空（内置）  | H 文件模板，额外支持 `${includeGuard}`。                                  |

“总工程文件夹”不是 VS Code 设置项，而是按当前工程保存在 workspaceState 中，通过左侧面板或命令面板设置与恢复。它只影响后续目录选择器的起点和默认回退，不会移动或改写已有文件。

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
