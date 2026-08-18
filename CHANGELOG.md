# 更新日志 / Changelog

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
