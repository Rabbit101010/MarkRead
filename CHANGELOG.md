# 更新日志 / Changelog

## v0.5.3
- **优化：「文件 ▾」菜单位置**。将「文件 ▾」下拉按钮从工具栏右侧移至最左侧（「打开」按钮之前），更符合操作习惯；菜单位于最左时下拉改为向左对齐展开（`.menu-group.left`），避免溢出屏幕左边界。功能与快捷键不变。
- 版本号对齐：package.json 与 tauri.conf.json 统一为 0.5.3。

## v0.5.2
- **优化：工具栏收拢**。将原「保存 / 另存为 / PDF / Word / 主题」五个独立按钮合并为一个「文件 ▾」下拉按钮，点击展开菜单选择；菜单项保留原快捷键提示（⌘S / ⌘⇧S / ⌘⇧P / ⌘⇧W / ⌘T）。有未保存修改时该按钮保留「脏点」高亮（边框与文字转主题色）。点击菜单外区域自动收起。快捷键与功能逻辑不变。
- 版本号对齐：package.json 与 tauri.conf.json 统一为 0.5.2。

## v0.5.1
- **修复：导出 PDF / Word 失效**。
  - Word：渲染层调用 `window.api.writeFileBytes`，而桥接层只暴露了 `saveFileBytes`，方法名不一致导致 `is not a function`。已统一为 `writeFileBytes`。
  - PDF：原实现依赖 `window.print()`，但 Tauri 2 的 WKWebView 在 macOS 上默认不实现打印（点击无反应）。改为在本地用 `html2pdf.js`（jsPDF + html2canvas）将正文渲染为真实 `.pdf` 文件，复用「保存对话框 → 写字节」落盘，离线可用；输出为栅格化 PDF，深色主题下背景强制为白底以保证可读。
  - 版本号对齐：package.json 与 tauri.conf.json 统一为 0.5.1。

## v0.5.0
- **新增：文档内查找（Cmd/Ctrl+F）**。
  - 阅读 / 分屏模式：高亮正文全部命中（黄色），当前命中高亮为强调色并自动滚动到视野中央；支持「上一个 / 下一个」跳转（按钮、Enter / Shift+Enter、Cmd+G 也可），实时显示「当前/总数」计数；可勾选「区分大小写」。
  - 编辑模式：在 Markdown 源码中查找，命中项直接在编辑框内选中并滚动到对应行（无内联高亮，避免改动源码文本）。
  - Esc 关闭；重新渲染（实时预览 / 切换主题）后若仍有查找词会自动重新高亮。菜单「编辑 ▸ 查找…」亦可触发。

## v0.4.1
- **修复：编辑器不自动换行**。将 `#editor` 的 `white-space` 由 `pre` 改为 `pre-wrap`，并加 `overflow-wrap: break-word`。现在「编辑」模式与「分屏」模式（含拖动分隔条收窄左栏）下，Markdown 源码都会按窗口宽度自动换行；超长无空格链接/代码也会断行。仅 CSS 改动，无需重编 Rust。

## v0.4.0
- **新增：导出 PDF 与 Word**。
  - 工具栏「PDF」「Word」按钮，或菜单「文件 ▸ 导出为 PDF… / 导出为 Word…」（`Cmd+Shift+P` / `Cmd+Shift+W`）。
  - **PDF**：原方案调用系统打印面板「存储为 PDF」并新增 `@media print` 样式；该方式因 Tauri WKWebView 不支持 `window.print()` 已在 v0.5.1 改为本地 `html2pdf.js` 生成（见 v0.5.1）。
  - **Word**：在本地（离线）用 `html-docx-js` 将当前渲染后的 HTML 转为真正的 `.docx`（标题/列表/表格/代码块/图片尽量保留），经保存对话框落盘。
  - Rust 侧新增 `write_file_bytes` 命令（写二进制）；`html-docx-js` 改用浏览器 UMD 构建（内联 DOCX 模板资源，避免 Node `fs` 依赖）。
- 版本号对齐：package.json 与 tauri.conf.json 统一为 0.4.0。

## v0.3.0
- **新增：多种开源字体选择**。在「帮助」面板的「显示设置」中可分别切换正文与代码字体，选择即时生效并本地保存（localStorage）。
  - 内置 5 款 SIL OFL 开源字体：思源黑体 Noto Sans SC、思源宋体 Noto Serif SC、马善政楷书 Ma Shan Zheng、Inter、JetBrains Mono。
  - 文艺中文选项原计划用「霞鹜文楷 LXGW WenKai」，因其无 woff2 子集分发、仅有大体积 TTF，故改用同样 OFL 的「马善政楷书」。
  - 新增 `scripts/copy-frontend.js`：修复项目路径含空格时 Tauri 2 未能把 `frontendDist` 拷入 macOS 应用 bundle 的问题（CI 路径无空格故不受影响）。
- 版本号对齐：package.json 与 tauri.conf.json 统一为 0.3.0。

## v0.2.0
- 跨平台发布：macOS universal `.dmg` + Windows `.msi`（GitHub Actions）。
- 修复 Windows 构建中 macOS 专用 `RunEvent::Opened` 导致的编译失败。
- 新增 MIT LICENSE。

## v0.1.0
- 初始版本：双栏联动定位、自动保存、目录大纲、KaTeX / Mermaid、多文档标签页、暗亮主题。
