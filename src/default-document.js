const fence = '```';

export const defaultDocument = `# Markdown 语法速查

左边写，右边即时渲染。所有内容都留在这台机器上，不联网、不上传。

## 标题

用 1 到 6 个井号表示层级。左侧大纲栏会用同样的井号画出深度，跳级会一眼看出来。

## 强调

*单个星号是斜体*\\
_下划线也是斜体_

**两个星号是加粗**\\
__两个下划线也是加粗__

_可以 **嵌套** 使用_，也可以 ~~加删除线~~。

## 列表

### 无序列表

- 用连字符开头
- 缩进两个空格表示嵌套
  - 像这样
  - 再来一条

### 有序列表

1. 数字加点
2. 编号不必写对，渲染时会重排
3. 第三条

### 任务列表

- [x] 实时渲染 Markdown
- [x] 代码块语法高亮
- [x] Mermaid 图表
- [ ] 打开本地文件夹并全文检索

## 引用

> Markdown 是 John Gruber 于 2004 年创造的轻量级标记语言，语法本身就是可读的纯文本。
>
> > 引用可以嵌套。

## 表格

| 语法 | 渲染结果 | 备注 |
| --- | --- | :---: |
| \`**文字**\` | **文字** | 加粗 |
| \`*文字*\` | *文字* | 斜体 |
| \`\` \`文字\` \`\` | \`文字\` | 行内代码 |

## 代码

行内代码用反引号包起来，比如 \`npm run dev\`。

${fence}javascript
// 中英文混排在等宽字体里也能对齐
const slug = (text) =>
  text.toLowerCase().trim().replace(/\\s+/g, '-');

console.log(slug('Hello 世界'));
${fence}

${fence}python
def fib(n: int) -> int:
    """返回第 n 个斐波那契数"""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
${fence}

## Mermaid 图表

${fence}mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[完成]
  B -->|否| D[另一条路径]
${fence}

## 链接与图片

标题可以做锚点，跳回[列表](#列表)一节。

外部链接会在新标签页打开，比如 [CommonMark 规范](https://commonmark.org/)。

![这是图片说明](/image/Markdown-mark.svg "鼠标悬停时显示的标题")

## 分隔线

---

写完的内容会自动存在浏览器本地，刷新不会丢。
`;
