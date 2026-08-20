# 更新日志 / Changelog

## v0.4.1
- **修复：编辑器不自动换行**。将 `#editor` 的 `white-space` 由 `pre` 改为 `pre-wrap`，并加 `overflow-wrap: break-word`。现在「编辑」模式与「分屏」模式（含拖动分隔条收窄左栏）下，Markdown 源码都会按窗口宽度自动换行；超长无空格链接/代码也会断行。仅 CSS 改动，无需重编 Rust。

## v0.4.0
- **新增：导出 PDF 与 Word**。
  - 工具栏「PDF」「Word」按钮，或菜单「文件 ▸ 导出为 PDF… / 导出为 Word…」（`Cmd+Shift+P` / `Cmd+Shift+W`）。
  - **PDF**：调用系统打印面板「存储为 PDF」，零依赖、版式完美（沿用当前主题与字体）。新增 `@media print` 打印样式，仅输出正文、隐藏界面元素。
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
