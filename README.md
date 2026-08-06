# Markdown 预览

本地优先的 Markdown 编辑器。全部在浏览器里跑，不需要账号，不发任何网络请求，断网可用。

- Monaco 编辑器，Markdown 语法高亮
- 实时预览，沿用 GitHub Markdown 样式，明暗双主题
- 代码块语法高亮（highlight.js，按需注册 35 种语言）
- Mermaid 图表（按需加载）
- 打开本地文件夹，浏览、编辑、全文检索里面的 Markdown 文档（`⌘K`）
- 最近打开的文件夹记在 IndexedDB 里，下次一次授权即可恢复
- 侧栏一栏到底：文件树与当前文档的标题树连成同一棵，标题深度用文档自己的井号绘制
- 语法工具栏：按钮以其插入的语法为标签
- 编辑 / 分栏 / 阅读 三种视图，可拖动分隔条，窄屏切换为标签页
- 导出 PDF

界面为中文。所有文案集中在 `src/modules/strings.js`。

## 两种保存模式

| 状态 | 文档来源 | 保存到 |
| --- | --- | --- |
| 未打开文件夹 | 草稿缓冲区 | `localStorage`，防抖 300ms |
| 已打开文件夹 | 磁盘上的那个文件 | 原文件，防抖 700ms |

`⌘S` 跳过防抖立即写入。标题栏的圆点如实反映缓冲区与磁盘是否一致——未保存时是红色，而不是像云端编辑器那样一直显示"已保存"。

## 环境要求

Node.js 20 或更新版本。

## 开发

```
npm install
npm run dev
```

## 构建

```
npm run build     # 输出到 dist/
npm run preview   # 本地预览构建产物
```

`dist/` 是纯静态产物。编辑器、字体、预览样式表全部打包在内，不依赖任何 CDN，断网和纯静态托管下都能工作。

## 目录

```
index.html                 页面骨架 + 首屏前的主题引导脚本
src/main.js                装配
src/default-document.js    初始文档
src/modules/
  strings.js               全部界面文案
  editor.js                Monaco 配置
  renderer.js              Markdown → 净化后的 HTML
  highlight.js             按需注册语言的 highlight.js
  mermaid.js               图表渲染（动态载入）
  rail.js                  侧栏：文件树 + 标题树
  toolbar.js               语法工具栏
  workspace.js             文件夹状态与两种保存模式
  files.js                 File System Access 封装
  idb.js                   IndexedDB，存放文件夹句柄
  search.js                文件夹内全文检索索引
  palette.js               ⌘K 搜索面板
  theme.js                 明暗主题，内联预览样式表
  layout.js                分栏、视图模式、侧栏折叠、窄屏标签页
  scroll-sync.js           编辑区与预览区双向滚动联动
  export.js                PDF 导出（动态载入）
  storage.js               带命名空间的 localStorage
src/styles/                应用外壳样式 + github-markdown 主题
```

## 浏览器支持

打开文件夹依赖 [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API)，目前只有 Chromium 系（Chrome、Edge、Arc）支持。在 Firefox 和 Safari 里，文件夹相关的入口会自动隐藏而不是留下点不动的按钮，编辑器本身照常可用，内容存在浏览器本地。

遍历文件夹时跳过 `node_modules`、`.git`、`dist` 等目录和所有点开头的目录，最多 6 层、2000 个文件。

## 关于中文排版

`IBM Plex Mono` 不含 CJK 字形，中文按字回退到系统界面字体（PingFang SC / 微软雅黑 / Noto Sans CJK）。拉丁字母和 Markdown 语法符号保持等宽——大纲栏的井号列和工具栏的语法标签依赖这一点。

预览区在 `github-markdown-css` 之上做了 CJK 修正：行高从 1.5 提到 1.75，启用 `line-break: strict`。这些规则用 `#output` 限定，因为主题样式表是运行时注入到 `<head>` 末尾的，单类选择器会被它盖掉。

## 来源

基于 [tanabe/markdown-live-preview](https://github.com/tanabe/markdown-live-preview) 改写。

## 许可

MIT，见 [LICENSE](LICENSE)。
