# MarkRead

> 一个基于 Tauri 2 的轻量级 Markdown 阅读 / 编辑工具，主打「双栏联动定位」与「零依赖离线可用」。
> A lightweight Markdown reader/editor built on Tauri 2, featuring dual-pane click-to-locate and fully offline operation.

[English](#english) | [中文](#中文)

---

## 中文

### 简介
MarkRead 是一个用 Tauri 2（Rust + WebView）构建的桌面 Markdown 工具。它把「阅读、编辑、双栏预览」三种模式整合在一个窗口里，所有公式、代码高亮、图标资源都**本地打包**，不依赖任何外网 CDN，断网也能用。

### 功能特性
- **三种模式**：阅读（纯预览）/ 双栏（左编辑右预览）/ 编辑（纯源码）。
- **自动保存 + 另存为**：编辑或双栏模式下输入约 1 秒后自动写回原文件；也可手动「另存为」另存副本。
- **双栏双击关联定位**：
  - 左侧双击某行 → 右侧平滑滚动到对应段落并高亮。
  - 右侧双击正文 → 左侧编辑器把光标定位到对应源行。
  - 工具栏按钮（↦ 预览 / ↤ 编辑）与快捷键 `Cmd+Enter` 也可触发。
- **可拖拽分隔条**：双栏模式下拖动中间竖条自定义左右栏宽（自动记忆）。
- **暗 / 亮主题**：一键切换，适配长时间阅读。
- **目录大纲**：`Cmd+\` 呼出侧边大纲，点击跳转。
- **数学公式与图表**：内置 KaTeX（LaTeX 公式）与 Mermaid（流程图 / 时序图等）。
- **自包含资源**：KaTeX 字体、代码高亮样式等都随包发布，无需联网。

### 快捷键
| 快捷键 | 功能 |
|---|---|
| `Cmd+S` | 保存 |
| `Cmd+Shift+S` | 另存为 |
| `Cmd+\` | 目录大纲 |
| `Cmd+T` | 切换主题 |
| `Cmd+Enter` | 双栏关联定位（编辑器聚焦→跳预览，预览聚焦→跳编辑器） |
| 双击左/右栏 | 左→右 / 右→左 关联定位 |

### 安装与构建（从源码）
前置条件：Node.js（含 npm）、Rust 工具链、以及 Tauri 2 所需的 macOS 构建依赖（Xcode Command Line Tools）。

```bash
git clone https://github.com/Rabbit101010/MarkRead.git
cd MarkRead
npm install
npm run tauri build
```

构建完成后，应用位于：

```
src-tauri/target/release/bundle/macos/MarkRead.app
```

把它拖到 `/Applications` 即可长期使用。

### 下载（预编译）
不想自己编译？前往 **[Releases](https://github.com/Rabbit101010/MarkRead/releases)** 下载 `MarkRead-macos.zip`，解压后把 `MarkRead.app` 拖入「应用程序」文件夹即可。

### 技术栈
Tauri 2 · Rust · markdown-it · KaTeX · Mermaid · highlight.js · 原生 macOS WebView (WKWebView)

### 许可证
本项目当前**未指定许可证**。如需开源发布，可添加 `LICENSE` 文件（例如 MIT）。

---

## English

### Overview
MarkRead is a desktop Markdown tool built with Tauri 2 (Rust + WebView). It combines three modes — reading, editing, and split-pane preview — into a single window. All math rendering, code highlighting, and icons are **bundled locally**, with no external CDN dependency, so it works fully offline.

### Features
- **Three modes**: Read (preview only) / Split (edit on the left, preview on the right) / Edit (source only).
- **Auto-save + Save As**: in Edit/Split mode, edits are written back to the original file after ~1s of inactivity; you can also "Save As" to a new file manually.
- **Dual-pane click-to-locate**:
  - Double-click a line on the left → the right pane smoothly scrolls to the matching block and highlights it.
  - Double-click body text on the right → the left editor moves the cursor to the corresponding source line.
  - Toolbar buttons (↦ Preview / ↤ Editor) and the `Cmd+Enter` shortcut do the same.
- **Resizable splitter**: drag the center divider in Split mode to adjust pane widths (remembered automatically).
- **Dark / Light theme**: one-click toggle for comfortable reading.
- **Table of contents**: press `Cmd+\` to open the side outline and jump to any heading.
- **Math & diagrams**: built-in KaTeX (LaTeX) and Mermaid (flowcharts, sequence diagrams, etc.).
- **Self-contained assets**: KaTeX fonts and highlight styles ship with the app — no network needed.

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Cmd+S` | Save |
| `Cmd+Shift+S` | Save As |
| `Cmd+\` | Table of contents |
| `Cmd+T` | Toggle theme |
| `Cmd+Enter` | Dual-pane locate (editor focus → jump preview; preview focus → jump editor) |
| Double-click left/right pane | Locate left→right / right→left |

### Install & Build (from source)
Prerequisites: Node.js (with npm), the Rust toolchain, and the macOS build dependencies required by Tauri 2 (Xcode Command Line Tools).

```bash
git clone https://github.com/Rabbit101010/MarkRead.git
cd MarkRead
npm install
npm run tauri build
```

After the build, the app is at:

```
src-tauri/target/release/bundle/macos/MarkRead.app
```

Drag it to `/Applications` for permanent use.

### Download (prebuilt)
Prefer not to build? Grab `MarkRead-macos.zip` from the **[Releases](https://github.com/Rabbit101010/MarkRead/releases)** page, unzip, and drag `MarkRead.app` into your Applications folder.

### Tech Stack
Tauri 2 · Rust · markdown-it · KaTeX · Mermaid · highlight.js · native macOS WebView (WKWebView)

### License
This project is currently **unlicensed**. To release it openly, add a `LICENSE` file (e.g. MIT).
