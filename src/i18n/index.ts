/**
 * Chinese-first UI copy for commands, quick picks and notifications.
 *
 * Domain/core errors keep their detailed technical wording in the core modules;
 * this catalog covers the interactive surface and can be mirrored by another
 * locale in the future.
 */
export const t = {
  buttons: {
    continueAdd: '继续添加',
    saveAndContinue: '保存并继续',
  },
  project: {
    pickTitle: '选择当前 Keil 工程',
    pickPlaceholder: '工作区中找到多个 .uvprojx 工程',
    browse: '$(folder-opened) 浏览其他 .uvprojx…',
    fileDialogTitle: '选择 Keil MDK5 工程文件',
    fileFilter: 'Keil MDK5 Project',
    existingFilesDialogTitle: '选择要加入 Keil 工程的文件',
    sourceFilesFilter: 'Keil Source Files',
    allFilesFilter: 'All Files',
  },
  target: {
    pickTitle: '选择 Target',
    pickPlaceholder: '工程包含多个 Target，本次只修改其中一个',
    lastUsed: '上次使用',
  },
  group: {
    pickTitle: (targetName: string) => `选择 Group（Target: ${targetName}）`,
    pickPlaceholder: '文件将加入此 Group',
    createLabel: '$(add) 创建新 Group…',
    createDescription: (targetName: string) => `在 Target "${targetName}" 中`,
    inputTitle: (targetName: string) => `新建 Group（Target: ${targetName}）`,
    inputPrompt: '输入 Group 名称。Group 是 Keil 工程中的虚拟分组，不对应磁盘目录。',
    inputPlaceholder: '例如 App、Drivers、BSP',
    emptyError: 'Group 名称不能为空。',
    controlError: 'Group 名称不能包含控制字符。',
    existsError: (name: string) => `Group "${name}" 已存在。`,
  },
  directory: {
    pickTitle: '选择新文件所在目录',
    pickPlaceholder: '目录默认来自右键位置或 Group 中文件的公共目录',
    defaultLabel: '$(folder) 使用当前目录',
    defaultDetail: '新文件将创建在此目录',
    projectRootLabel: '$(root-folder) 工程根目录',
    browseLabel: '$(folder-opened) 选择其他目录…',
    browseTitle: '选择新文件所在目录',
  },
  file: {
    inputTitle: (extension: '.c' | '.h') =>
      `新建 Keil ${extension === '.c' ? 'C' : 'H'} 文件`,
    inputPrompt: (extension: '.c' | '.h') => `输入文件名；扩展名 ${extension} 可省略。`,
    inputPlaceholder: (extension: '.c' | '.h') =>
      extension === '.c' ? '例如 app 或 app.c' : '例如 app 或 app.h',
    emptyError: '文件名不能为空。',
  },
  encoding: {
    pickTitle: '选择新文件编码',
    utf8Label: 'UTF-8',
    gbLabel: 'GB2312 / GBK',
    recommended: '推荐',
    utf8Detail: '无 BOM，VS Code 可直接打开和保存。',
    gbDetail: '兼容旧版 Keil 工程；创建后默认不自动打开，编辑前需 Reopen with Encoding。',
    countsPrefix: '统计',
    directoryPrefix: '目录',
    recommendedPrefix: '推荐',
    sourceSetting: '来自 keilProject.newFileEncoding 设置',
    sourceFolder: '来自目标目录多数编码',
    sourceGroup: '来自 Group 多数编码',
    sourceProject: '来自工程源文件多数编码',
    sourceAsk: '无法从已有文件判断，请选择',
    sourceMixed: '目录内编码混合，请确认',
    remembered: '已记住此目录上次选择',
    mixedNotice: '该目录同时存在 UTF-8 和 GB 文件，请确认本次选择。',
  },
  preview: {
    targetLabel: 'Target',
    groupLabel: 'Group',
    addHeader: (count: number) => `将添加（${count}）：`,
    skipHeader: (count: number) => `将跳过（${count}）：`,
    warningHeader: '注意：',
    title: (count: number) => `将 ${count} 个文件加入 Keil 工程，是否继续？`,
  },
  commands: {
    targetNotFound: (name: string) => `未找到 Target "${name}"。`,
    directoryMissing: (directoryPath: string) => `目标目录不存在：${directoryPath}`,
    directoryNotDirectory: (directoryPath: string) =>
      `目标路径不是目录：${directoryPath}`,
    deleteAfterFailure: (filePath: string) =>
      `工程更新失败，且无法自动删除新文件。请手动检查：${filePath}`,
    noFileName: '文件名无效。',
    duplicateTargetFile: (name: string) =>
      `文件 "${name}" 已在当前 Target 的工程条目中，不能重复添加。`,
    fileExists: (filePath: string) => `文件已存在，不会覆盖：${filePath}`,
    differentDrive: '该文件位于工程所在盘符之外，工程中将使用绝对路径。',
    outsideProject: '该文件位于工程目录之外，工程中将使用 ..\\ 相对路径。',
    unsupportedFile: (name: string) => `不支持的文件类型：${name}`,
    reloadHint: '若 Keil 正打开该工程，请重新加载工程文件。',
    headerNotIncluded: '头文件已加入工程，但 Include Path 未修改。',
    createdFile: (
      name: string,
      targetName: string,
      groupName: string,
      headerNote: string,
    ) =>
      `已创建 ${name} 并加入 Target "${targetName}" / Group "${groupName}"。${headerNote}${t.commands.reloadHint}`,
    autoOpenFailed: (reason: string) => `文件已创建并加入工程，但自动打开失败：${reason}`,
    gbAutoOpenWarning:
      '该文件使用 GB2312/GBK 编码。若编辑器显示乱码，请先关闭而不保存，再使用 “Reopen with Encoding” 选择 GBK 或 GB18030。',
    gbClosedInfo:
      '文件使用 GB2312/GBK 编码，已按设置保持关闭。编辑前请使用 “Reopen with Encoding” 选择 GBK 或 GB18030，避免以 UTF-8 保存导致乱码。',
    folderSkip: '文件夹暂不支持递归添加，请选择文件。',
    notAFile: '不是普通文件。',
    missingFile: '文件不存在或无法访问。',
    unsupportedExtension: (extensions: string) =>
      `不支持的文件类型（支持 ${extensions}）。`,
    duplicateExisting: '当前 Target 中已存在该文件，已去重。',
    duplicateSelection: '本次选择中重复出现。',
    differentDrivePreview: (filePath: string) =>
      `位于其他盘符，将写入绝对路径：${filePath}`,
    outsideProjectPreview: (filePath: string) =>
      `位于工程目录之外，将使用 ..\\ 相对路径：${filePath}`,
    noAddableFiles: (details: string) =>
      `没有可添加的文件。${details.length > 0 ? `\n${details}` : ''}`,
    addedFiles: (
      targetName: string,
      groupName: string,
      count: number,
      skippedNote: string,
    ) =>
      `已向 Target "${targetName}" / Group "${groupName}" 添加 ${count} 个文件。${skippedNote}${t.commands.reloadHint}`,
    skippedNote: (count: number) => ` 跳过 ${count} 个文件。`,
    includePathWarning:
      '已添加头文件，但本扩展不会修改 Include Path。若编译找不到头文件，请手动在 Keil 中添加包含路径。',
    projectSelected: (projectPath: string) => `当前 Keil 工程已切换为：${projectPath}`,
    configuredProjectWarning: (projectPath: string) =>
      `当前设置 keilProject.projectFile 指向：${projectPath}。该设置会优先于本次选择，请修改设置后再使用其他工程。`,
    groupCreated: (targetName: string, groupName: string) =>
      `已在 Target "${targetName}" 中新建 Group "${groupName}"。${t.commands.reloadHint}`,
    operationFailed: (message: string) => `操作失败：${message}`,
  },
} as const;
