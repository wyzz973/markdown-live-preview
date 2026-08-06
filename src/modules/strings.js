// All interface copy, in one place.
//
// The app ships in Chinese only. Centralising the strings keeps Chinese
// literals out of the logic modules and makes a second locale a matter of
// swapping this object rather than hunting through the DOM code.

export const t = {
    appName: 'Markdown 预览',

    // toolbar actions
    reset: '重置',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    exportPdf: '导出 PDF',
    exporting: '导出中',
    syncScroll: '同步滚动',

    // view modes
    modeEdit: '编辑',
    modeSplit: '分栏',
    modeRead: '阅读',
    modeGroupLabel: '视图模式',

    // theme
    toggleTheme: '切换主题',
    toThemeDark: '切换到暗色主题',
    toThemeLight: '切换到亮色主题',

    // rail
    railLabel: '文档导航',
    outline: '大纲',
    outlineEmpty: '还没有标题',
    outlineEmptyHint: '写一行 # 开头的标题，它会出现在这里。',
    headingCount: (n) => `${n} 个标题`,
    toggleRail: '收起／展开侧栏',
    untitled: '未命名文档',
    edited: '未保存',
    folderRoot: '根目录',

    // folders
    noFolder: '未打开文件夹',
    openFolder: '打开文件夹',
    closeFolder: '关闭文件夹',
    recentFolders: '最近打开',
    noRecentFolders: '还没有打开过文件夹。',
    switchFolder: '切换文件夹',
    fileCount: (n) => `${n} 个文档`,
    emptyFolderTitle: '未打开文件夹',
    emptyFolderBody: '打开一个文件夹就能浏览和检索里面的 Markdown 文档。文件直接从磁盘读写，不会离开这台机器。',
    emptyFolderCaveat: '读取本地文件夹需要 File System Access API，目前只有 Chrome、Edge、Arc 等 Chromium 浏览器支持。在 Firefox 和 Safari 里编辑器照常可用，内容存在浏览器本地。',
    folderEmpty: '这个文件夹里没有 Markdown 文档。',
    permissionDenied: '没有获得文件夹访问授权。',
    openFolderFailed: '打开文件夹失败。',
    readFileFailed: '读取文件失败。',
    writeFileFailed: '保存失败，改动仍在编辑器里。',
    scratchBuffer: '草稿',

    // search
    search: '搜索',
    searchPlaceholder: '在文件夹内全文搜索',
    searchHint: '输入关键词，搜索文件夹里的所有文档。',
    searchNoMatch: '没有匹配的内容。',
    searchNeedsFolder: '先打开一个文件夹才能搜索。',
    lineNumber: (n) => `第 ${n} 行`,

    // editor
    editorLabel: 'Markdown 源码',
    dividerLabel: '拖动调整编辑区与预览区宽度',
    unsaved: '有未保存的改动',
    saved: '已保存到本地',

    // confirmations
    resetConfirm: '确定要重置吗？当前内容会丢失。',

    // formatting toolbar — the label is the syntax each button writes,
    // so only the tooltip needs translating.
    toolbarLabel: '格式',
    tools: {
        heading: '标题',
        bold: '加粗',
        italic: '斜体',
        strike: '删除线',
        code: '行内代码',
        quote: '引用',
        bullet: '无序列表',
        ordered: '有序列表',
        task: '任务项',
        fence: '代码块',
        link: '链接',
        image: '图片',
        table: '表格'
    },

    // placeholder text inserted by the toolbar when nothing is selected
    placeholders: {
        bold: '加粗文字',
        italic: '斜体文字',
        strike: '删除线文字',
        code: '代码',
        link: '链接文字',
        image: '图片说明',
        fence: '在这里写代码'
    },

    tableTemplate: '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |'
};
