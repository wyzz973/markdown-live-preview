# 工具站

本地优先的开发者工具站。全部在浏览器里跑，不需要账号，不发任何网络请求，断网可用。

## 工具

| 工具 | 工作台 | 能做什么 |
| --- | --- | --- |
| **Markdown** | 文档型 | 实时预览、大纲、导出 PDF（矢量、可选中、不断页） |
| **JSON** | 文档型 | 格式化、校验、修复、JSONPath 查询、转 YAML/CSV/Markdown 表格/TypeScript/Go |
| **流式响应还原** | 工具型 | 把大模型的 SSE / JSONL 抓包还原成完整回复，按 Markdown 渲染 |
| **Unicode 转换** | 工具型 | 中文与 `\uXXXX` 互转 |

两种工作台共用一副骨架：文档型是 `侧栏 │ 编辑 │ 预览`，工具型是 `输入 │ 输出`。
新增工具是往 `src/modules/tools.js` 里加一项加它自己的模块，不动导航。

### 流式响应还原

这一条是这个站独有的。现有工具只被动展示 SSE 抓包，没有一个把它**还原**成消息本身；
而还原出来的东西几乎总是 Markdown——本站正好有一流的 Markdown 渲染器。

- 自动识别 Anthropic / OpenAI / Gemini / Ollama 的流式格式，以及 SSE 与 JSONL 两种分帧
- 把 `delta` 拼回完整正文与思考内容
- **重组工具调用参数**：OpenAI 与 Anthropic 都把 `arguments` 当字符串碎片跨帧下发，拼起来才是合法 JSON
- 提取 token 用量（Anthropic 的计数是累计值，取最大而非求和）
- 流被截断时用 `jsonrepair` 补全，并如实标注"流被截断""修复 N 帧"
- 还原出的正文可以一键送进 Markdown 工具继续编辑

### 导出 PDF

不用 html2canvas / jsPDF。那条路是把预览**截图**成位图再按像素高度切片，分页器对内容
一无所知，结果是列表项、代码块、甚至标题的字被从中间切开；Mermaid 的 SVG 溢出它也跟不了，
右半边直接丢失；产物是几张整页图片，文字选不中、链接点不动。

这里改为自己构造一份打印文档（隐藏 iframe + `@media print` 规则），交给浏览器自带的
PDF 排版引擎：

- `break-inside: avoid` 保护代码块、表格、引用、列表项、图表
- `break-after: avoid` 让标题不被独自留在页底
- Mermaid 以**矢量**输出，宽高双向约束到可打印区域（A4 去掉页边距只剩 261mm，
  只限宽的话过高的图仍会跨页截断）
- 长代码行改为换行而非右侧裁切；宽表格从 `display:block` 改回真表格，否则右侧列被裁
- 文字是真文字：可选中、可搜索、链接可点

这些覆盖规则都用 `.markdown-body` 限定——github-markdown-css 的
`.markdown-body pre code` 会压过裸元素选择器，第一版就是因此丢了换行规则。

代价：走系统打印对话框（选"存储为 PDF"），文件名在对话框里定。

### JSON

编辑体验直接用 Monaco 自带的 JSON 语言服务（schema 校验、精确到字符的错误定位、折叠、补全），
所以本项目只写它没有的部分：结构大纲、转换、转义，以及 **Unicode ↔ 中文**——
国内 API 大量返回 `\uXXXX` 转义，西方工具普遍没有这个功能。

预览区刻意不做树视图：Monaco 已经折叠和着色，侧栏已经给出结构，第三份同样的树不产生新信息。
那一栏改做**查询与转换**。

- Monaco 编辑器，Markdown 语法高亮
- 实时预览，沿用 GitHub Markdown 样式，明暗双主题
- 代码块语法高亮（highlight.js，按需注册 35 种语言）
- Mermaid 图表（按需加载）
## 其余能力

- 打开本地文件夹，浏览、编辑、全文检索里面的 Markdown 与 JSON 文档（`⌘K`）
- 最近打开的文件夹记在 IndexedDB 里，下次一次授权即可恢复
- 侧栏一栏到底：文件树与当前文档的结构树连成同一棵。**左列说的是当前格式自己的记号**——Markdown 画 `#` `##` `###`，JSON 画 `{}` `[]`；两者都只列可导航的结构（标题 / 容器），不列叶子
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
src/tools/
  json-tool.js             JSON 预览面板：查询与转换
  stream-tool.js           流式响应还原
  unicode-tool.js          Unicode 互转
src/modules/
  tools.js                 工具注册表与文件类型归属
  json-tools.js            JSON 变换、结构扫描、类型生成
  stream-parse.js          SSE / JSONL 分帧与各厂商 delta 提取
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
