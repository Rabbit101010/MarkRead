import './api.js'; // Tauri bridge: exposes window.api (replaces Electron preload)
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { getCurrentWindow } from '@tauri-apps/api/window';
// Use the browser UMD build (dist/html-docx.js) — it inlines the DOCX template
// assets, whereas the npm "main" (build/api.js) requires Node's `fs` and only
// works server-side.
import htmlDocx from 'html-docx-js/dist/html-docx.js';
// html2pdf bundles jsPDF + html2canvas; used to render the article to a real
// (rasterized) PDF file — Tauri's WKWebView does not implement window.print().
import html2pdf from 'html2pdf.js';

/* ---------------- Markdown engine ---------------- */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(str, lang) {
    if (lang === 'mermaid') {
      // leave raw; we convert these to mermaid nodes after render
      return '';
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch (_) {
        /* fall through */
      }
    }
    return '';
  },
});

/* ---------------- Source-line mapping (click-to-link panes) ---------------- */
// Tag each block-level element in the preview with its source line so we can
// jump between the editor caret and the rendered block on demand (discrete
// dblclick / Cmd+Enter — NOT a live scroll-sync).
const defaultRender = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);
function tagSourceLine(ruleName) {
  const original = md.renderer.rules[ruleName] || defaultRender;
  md.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (t.map) {
      t.attrSet('data-source-line', String(t.map[0]));
      if (t.map[1] > t.map[0]) t.attrSet('data-source-line-end', String(t.map[1]));
    }
    return original(tokens, idx, options, env, self);
  };
}
['paragraph_open', 'heading_open', 'blockquote_open', 'bullet_list_open',
 'ordered_list_open', 'list_item_open', 'table_open', 'thead_open', 'tbody_open',
 'tr_open', 'hr', 'dl_open', 'dt_open', 'dd_open'].forEach(tagSourceLine);
const origFence = md.renderer.rules.fence || defaultRender;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (t.map) {
    t.attrSet('data-source-line', String(t.map[0]));
    if (t.map[1] > t.map[0]) t.attrSet('data-source-line-end', String(t.map[1]));
  }
  return origFence(tokens, idx, options, env, self);
};

/* ---------------- Math protection ---------------- */
function protectMath(src) {
  const store = [];
  // block math $$ ... $$
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    store.push({ t: 'block', tex: tex.trim() });
    return `\n\n@@MATH${store.length - 1}@@\n\n`;
  });
  // inline math $ ... $ (not $$)
  src = src.replace(/(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\d)/g, (_, tex) => {
    store.push({ t: 'inline', tex: tex.trim() });
    return `@@MATH${store.length - 1}@@`;
  });
  return { src, store };
}

function restoreMath(html, store) {
  return html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const item = store[+i];
    try {
      return katex.renderToString(item.tex, {
        displayMode: item.t === 'block',
        throwOnError: false,
      });
    } catch (e) {
      return `<code class="math-error">${escapeHtml(item.tex)}</code>`;
    }
  });
}

/* ---------------- Mermaid ---------------- */
function mermaidThemeFor(theme) {
  return theme === 'dark' ? 'dark' : 'default';
}

function renderMermaid(root, theme) {
  const codeBlocks = root.querySelectorAll('code.language-mermaid');
  if (!codeBlocks.length) return;
  codeBlocks.forEach((code) => {
    const pre = code.parentElement;
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    pre.replaceWith(div);
  });
  try {
    mermaid.initialize({ startOnLoad: false, theme: mermaidThemeFor(theme), securityLevel: 'loose' });
    const p = mermaid.run({ nodes: Array.from(root.querySelectorAll('.mermaid')) });
    if (p && typeof p.catch === 'function') {
      p.catch((e) => console.error('mermaid render error', e));
    }
  } catch (e) {
    console.error('mermaid init error', e);
  }
}

/* ---------------- TOC ---------------- */
function buildToc(root) {
  const tocEl = document.getElementById('toc');
  const heads = Array.from(root.querySelectorAll('h1, h2, h3'));
  if (!heads.length) {
    tocEl.innerHTML = '<p class="toc-empty">（无标题）</p>';
    return;
  }
  heads.forEach((h, i) => {
    const id = `sec-${i}-${slugify(h.textContent)}`;
    h.id = id;
  });
  const items = heads
    .map((h) => {
      const level = +h.tagName[1];
      return `<a class="toc-item toc-${level}" href="#${h.id}" data-target="${h.id}">${escapeHtml(h.textContent)}</a>`;
    })
    .join('');
  tocEl.innerHTML = `<div class="toc-title">目录</div>${items}`;
  tocEl.querySelectorAll('a.toc-item').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const el = document.getElementById(a.dataset.target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'section';
}

/* ---------------- Helpers ---------------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- Click-to-link (editor <-> preview) ---------------- */
function caretLine(ta) {
  const pos = ta.selectionStart || 0;
  let line = 0;
  for (let i = 0; i < pos; i++) if (ta.value[i] === '\n') line++;
  return line; // 0-based source line index
}

function flashLocate(el) {
  if (!el) return;
  el.classList.add('locate-flash');
  setTimeout(() => el.classList.remove('locate-flash'), 750);
}

// Editor -> Preview: scroll the reading pane to the block containing the caret line.
function locatePreviewToLine(line) {
  const content = document.getElementById('content');
  if (!content) return;
  const els = content.querySelectorAll('[data-source-line]');
  if (!els.length) return;
  let target = els[0];
  for (const el of els) {
    const sl = parseInt(el.dataset.sourceLine, 10);
    if (sl <= line) target = el; else break;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flashLocate(target);
}

// Preview -> Editor: put the caret on the source line of the clicked block.
function locateEditorToLine(line) {
  const ta = document.getElementById('editor');
  if (!ta) return;
  const lines = ta.value.split('\n');
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(offset, offset);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
  flashLocate(ta);
}

// First block whose top is at/under the content viewport top (≈ what's on screen).
function topVisibleSourceLine() {
  const content = document.getElementById('content');
  if (!content) return 0;
  const cTop = content.getBoundingClientRect().top;
  const els = content.querySelectorAll('[data-source-line]');
  for (const el of els) {
    if (el.getBoundingClientRect().top >= cTop - 4) return parseInt(el.dataset.sourceLine, 10);
  }
  return els.length ? parseInt(els[els.length - 1].dataset.sourceLine, 10) : 0;
}

/* ---------------- State ---------------- */
let currentSource = '';
let currentPath = '';
let currentName = '';
let currentMode = 'read';
let isDirty = false;
let renderedSource = null; // last source rendered into the preview
const THEMES = ['light', 'sepia', 'dark'];

// Multi-document (tabs) model. The six `current*` vars above are the live view
// of the active document; each opened file is snapshotted into `docs` so we can
// switch away and back without losing source / mode / scroll / dirty state.
let docs = [];
let activeIndex = -1;
let docIdSeq = 0;

// In-page search state
let searchTerm = '';
let searchCase = false;
let matchEls = []; // <mark> elements (html path) or {start,end} (textarea path)
let curMatch = -1;
let searchMode = 'html'; // 'html' | 'textarea'
let replaceCursor = 0; // source offset for sequential single replace
let replaceWith = ''; // replacement text from #replace-input

const EMPTY_HTML = `<div id="empty" class="empty"><div class="empty-inner"><div class="logo">M↓</div><h1>MarkRead</h1><p>拖入 <code>.md</code> 文件，或点击左上角「打开」开始阅读。</p><p class="hint">支持 Mermaid 图表 · KaTeX 数学公式 · 代码高亮 · 多主题</p></div></div>`;

function getSplitWidth() {
  const editorEl = document.getElementById('editor');
  const m = /0 0 (\d+)px/.exec(editorEl.style.flex || '');
  return m ? parseInt(m[1], 10) : null;
}

function saveActiveToDoc() {
  if (activeIndex < 0 || !docs[activeIndex]) return;
  const d = docs[activeIndex];
  d.source = currentSource;
  d.path = currentPath;
  d.name = currentName;
  d.mode = currentMode;
  d.dirty = isDirty;
  d.renderedSource = renderedSource;
  d.tocOpen = document.getElementById('toc').classList.contains('open');
  const content = document.getElementById('content');
  d.scrollTop = content.scrollTop;
  const editorEl = document.getElementById('editor');
  d.editorScrollTop = editorEl.scrollTop;
  d.splitWidth = getSplitWidth();
}

function openDoc(data) {
  const path = (data && data.path) || '';
  if (path) {
    const idx = docs.findIndex((d) => d.path === path);
    if (idx >= 0) {
      activateDoc(idx, false);
      return;
    }
  }
  const doc = {
    id: ++docIdSeq,
    path,
    name: (data && data.name) || (path ? path.split('/').pop() : '未命名'),
    source: (data && data.content) || '',
    mode: loadSettings().defaultMode,
    tocOpen: loadSettings().tocOpen,
    scrollTop: 0,
    editorScrollTop: 0,
    splitWidth: null,
    dirty: false,
    renderedSource: null,
  };
  docs.push(doc);
  activateDoc(docs.length - 1, true);
}

let newDocSeq = 0;
function newDoc() {
  newDocSeq += 1;
  const name = newDocSeq === 1 ? '未命名' : `未命名 ${newDocSeq}`;
  openDoc({ path: '', name, content: '' });
}

function activateDoc(i, doRecent = false) {
  if (i === activeIndex) return;
  if (activeIndex >= 0 && docs[activeIndex]) saveActiveToDoc();
  activeIndex = i;
  const d = docs[i];
  currentSource = d.source;
  currentPath = d.path;
  currentName = d.name;
  currentMode = d.mode;
  isDirty = d.dirty;
  renderedSource = d.renderedSource;
  renderDocument(currentSource, currentPath, doRecent);
  setMode(currentMode);
  setDirty(isDirty);
  const tocEl = document.getElementById('toc');
  if (tocEl.classList.contains('open') !== d.tocOpen) toggleToc();
  const content = document.getElementById('content');
  const editorEl = document.getElementById('editor');
  if (d.splitWidth) editorEl.style.flex = `0 0 ${d.splitWidth}px`;
  requestAnimationFrame(() => {
    content.scrollTop = d.scrollTop || 0;
    editorEl.scrollTop = d.editorScrollTop || 0;
  });
  renderTabBar();
}

async function closeDoc(i) {
  const d = docs[i];
  if (!d) return;
  if (d.dirty && !confirm(`「${d.name}」有未保存的修改，关闭将丢弃。确定关闭？`)) return;
  docs.splice(i, 1);
  if (i === activeIndex) {
    if (docs.length === 0) {
      activeIndex = -1;
      showEmptyState();
    } else {
      const target = i > 0 ? i - 1 : 0;
      activeIndex = -1; // prevent saveActiveToDoc writing into the removed doc
      activateDoc(target, false);
    }
  }
  renderTabBar();
}

function showEmptyState() {
  currentSource = '';
  currentPath = '';
  currentName = '';
  currentMode = 'read';
  isDirty = false;
  renderedSource = null;
  const content = document.getElementById('content');
  content.innerHTML = EMPTY_HTML;
  document.getElementById('doc-name').textContent = '';
  document.body.dataset.mode = 'read';
  setDirty(false);
  renderTabBar();
}

function updateTabDirty(i, d) {
  const bar = document.getElementById('tabbar');
  const tab = bar && bar.querySelector(`.tab[data-idx="${i}"]`);
  if (!tab) return;
  let dot = tab.querySelector('.tab-dirty');
  if (d && !dot) {
    dot = document.createElement('span');
    dot.className = 'tab-dirty';
    dot.title = '未保存';
    tab.appendChild(dot);
  } else if (!d && dot) {
    dot.remove();
  }
}

function renderTabBar() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  if (docs.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = docs
    .map((d, i) => {
      const cls = 'tab' + (i === activeIndex ? ' active' : '');
      const dirty = d.dirty ? '<span class="tab-dirty" title="未保存"></span>' : '';
      const pop = d.path
        ? `<button class="tab-pop" data-pop="${i}" title="在新窗口打开（或拖拽页签到标签栏外）">⧉</button>`
        : '';
      return `<div class="${cls}" data-idx="${i}" draggable="true"><span class="tab-name">${escapeHtml(d.name)}</span>${pop}${dirty}<span class="tab-close" data-close="${i}" title="关闭">×</span></div>`;
    })
    .join('');
  bar.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close') || e.target.classList.contains('tab-pop')) return;
      activateDoc(parseInt(el.dataset.idx, 10), false);
    });
    el.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/mdr-tab', el.dataset.idx);
      tabOverBar = false;
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', (e) => {
      e.stopPropagation();
      el.classList.remove('dragging');
      if (!tabOverBar) popOutTab(parseInt(el.dataset.idx, 10));
      tabOverBar = false;
    });
  });
  bar.querySelectorAll('.tab-close').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoc(parseInt(el.dataset.close, 10));
    });
  });
  bar.querySelectorAll('.tab-pop').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      popOutTab(parseInt(el.dataset.pop, 10));
    });
  });
}

/* Tear a tab off into its own OS window. The source window keeps the rest of
   its tabs; the new window opens the same file fresh (saved first if dirty, so
   the detached copy reflects the latest edits). */
async function popOutTab(i) {
  const d = docs[i];
  if (!d) return;
  if (!d.path) {
    showStatus('该文档无本地路径，无法在新窗口打开（例如拖入的临时文件）');
    return;
  }
  if (d.dirty) {
    try { await doSave(); } catch (_) { /* best-effort */ }
  }
  try {
    await window.api?.detachTab(d.path);
  } catch (e) {
    alert('打开新窗口失败：' + (e && e.message ? e.message : e));
    return;
  }
  docs.splice(i, 1);
  if (i === activeIndex) {
    if (docs.length === 0) {
      activeIndex = -1;
      showEmptyState();
      await maybeCloseWindowIfEmpty();
    } else {
      const t = i > 0 ? i - 1 : 0;
      activeIndex = -1;
      activateDoc(t, false);
    }
  } else if (i < activeIndex) {
    activeIndex -= 1;
  }
  renderTabBar();
}

// If this is a detached (non-main) window and has no tabs left, close the OS window.
async function maybeCloseWindowIfEmpty() {
  try {
    const w = getCurrentWindow();
    if (w.label && w.label !== 'main') await w.close();
  } catch (_) { /* ignore */ }
}

let autoSaveEnabled = localStorage.getItem('mdr-autosave') !== 'false';
let autoSaveTimer = null;
let statusTimer = null;
let tabOverBar = false; // true while a tab is being dragged over the tab strip

const FONT_STACKS = {
  system: 'Georgia, "Times New Roman", "Songti SC", "STSong", "SimSun", serif',
  'noto-sans-sc': '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  'noto-serif-sc': '"Noto Serif SC", Georgia, "Songti SC", "STSong", "SimSun", serif',
  'ma-shan-zheng': '"Ma Shan Zheng", "Kaiti SC", STKaiti, KaiTi, serif',
  'inter': '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  'code-system': '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  'code-jetbrains-mono': '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
};

function loadSettings() {
  return {
    theme: localStorage.getItem('mdr-theme') || 'light',
    fontSize: parseInt(localStorage.getItem('mdr-fontsize') || '17', 10),
    tocOpen: localStorage.getItem('mdr-toc') !== 'false',
    fontBody: localStorage.getItem('mdr-font-body') || 'system',
    fontCode: localStorage.getItem('mdr-font-code') || 'system',
    contentWidth: localStorage.getItem('mdr-content-width') || 'normal',
    // 新开文档 / 启动时的默认模式；不再沿用「上次使用的模式」
    defaultMode: localStorage.getItem('mdr-default-mode') || 'read',
  };
}

/* 正文宽度档位：narrow 保持传统舒适行宽；normal/wide 随视口放宽，
   使全屏或大窗口下正文能占用更多空间；full 铺满可用宽度。 */
const CONTENT_WIDTHS = {
  narrow: '46rem',
  normal: 'clamp(46rem, 62vw, 88rem)',
  wide: 'clamp(52rem, 82vw, 112rem)',
  full: '100%',
};

function applySettings() {
  const s = loadSettings();
  document.body.className = `theme-${s.theme}`;
  document.documentElement.style.setProperty('--reader-font-size', s.fontSize + 'px');
  document.getElementById('toc').classList.toggle('open', s.tocOpen);
  const bodyStack = FONT_STACKS[s.fontBody] || FONT_STACKS.system;
  document.documentElement.style.setProperty('--font-body', bodyStack);
  const codeStack = FONT_STACKS['code-' + s.fontCode] || FONT_STACKS['code-system'];
  document.documentElement.style.setProperty('--font-code', codeStack);
  document.documentElement.style.setProperty(
    '--content-width',
    CONTENT_WIDTHS[s.contentWidth] || CONTENT_WIDTHS.normal
  );
}

function setTheme(theme) {
  localStorage.setItem('mdr-theme', theme);
  applySettings();
  // re-render to recolor mermaid diagrams; keep scroll position
  if (currentSource) renderDocument(currentSource, currentPath, false, true);
}

function cycleTheme() {
  const cur = loadSettings().theme;
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  setTheme(next);
}

function setFontSize(size) {
  const clamped = Math.max(12, Math.min(30, size));
  localStorage.setItem('mdr-fontsize', String(clamped));
  document.documentElement.style.setProperty('--reader-font-size', clamped + 'px');
}

function toggleToc() {
  const tocEl = document.getElementById('toc');
  const open = !tocEl.classList.contains('open');
  tocEl.classList.toggle('open', open);
  // remember per active document when one is open, else as the global default
  if (activeIndex >= 0 && docs[activeIndex]) docs[activeIndex].tocOpen = open;
  else localStorage.setItem('mdr-toc', String(open));
}

/* ---------------- Status hint (auto-save etc.) ---------------- */
function showStatus(text) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- Inline source editing (read mode) ---------------- */
// Double-click a block in read mode to edit its ORIGINAL Markdown source in
// place. We splice only that block's line range back into the source, so
// tables / math / code fences / mermaid survive untouched — no HTML→Markdown
// round-trip, hence zero fidelity loss.
let inlineEdit = null;

function topSourceBlock(el) {
  let b = el;
  while (b.parentElement) {
    const p = b.parentElement;
    if (!p.closest || !p.closest('.markdown-body')) break;
    if (p.dataset && p.dataset.sourceLine) b = p;
    else break;
  }
  return b;
}

function blockLineRange(block) {
  const start = parseInt(block.dataset.sourceLine, 10);
  if (Number.isNaN(start)) return null;
  const total = currentSource.split('\n').length;
  let end = parseInt(block.dataset.sourceLineEnd, 10);
  if (Number.isNaN(end) || end <= start) end = start + 1;
  return { start, end: Math.min(end, total) };
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
}

function beginInlineEdit(target) {
  if (inlineEdit) return;
  const block = topSourceBlock(target);
  const range = blockLineRange(block);
  if (!range) { showStatus('这一段定位不到源码，无法就地编辑'); return; }
  const lines = currentSource.split('\n');
  const text = lines.slice(range.start, range.end).join('\n');

  const ta = document.createElement('textarea');
  ta.className = 'inline-edit';
  ta.value = text;
  ta.spellcheck = false;
  const hint = document.createElement('div');
  hint.className = 'inline-edit-hint';
  hint.textContent = '正在编辑该段的 Markdown 源码 · ⌘/Ctrl+Enter 保存 · Esc 取消';

  block.style.display = 'none';
  block.parentNode.insertBefore(ta, block);
  block.parentNode.insertBefore(hint, block.nextSibling);

  inlineEdit = { block, ta, hint, ...range, original: text };

  ta.focus();
  ta.setSelectionRange(text.length, text.length);
  autoGrow(ta);
  ta.scrollIntoView({ block: 'nearest' });

  ta.addEventListener('input', () => autoGrow(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitInlineEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit(); }
  });
  ta.addEventListener('blur', () => { if (inlineEdit) commitInlineEdit(); });
}

function teardownInlineEdit() {
  if (!inlineEdit) return null;
  const cur = inlineEdit;
  inlineEdit = null;
  cur.ta.remove();
  cur.hint.remove();
  cur.block.style.display = '';
  return cur;
}

function cancelInlineEdit() {
  if (!inlineEdit) return;
  teardownInlineEdit();
  showStatus('已取消编辑');
}

function commitInlineEdit() {
  if (!inlineEdit) return;
  const cur = teardownInlineEdit();
  const next = cur.ta.value;
  if (next === cur.original) { showStatus('未做修改'); return; }
  const lines = currentSource.split('\n');
  lines.splice(cur.start, cur.end - cur.start, ...next.split('\n'));
  currentSource = lines.join('\n');
  if (activeIndex >= 0 && docs[activeIndex]) {
    docs[activeIndex].source = currentSource;
    docs[activeIndex].dirty = true;
  }
  setDirty(true);
  renderDocument(currentSource, currentPath, false, true);
  scheduleAutoSave();
  showStatus('已修改该段');
}

/* ---------------- Core render ---------------- */
function renderDocument(source, filePath, updateRecent = true, keepScroll = false) {
  currentSource = source;
  currentPath = filePath || '';
  if (filePath) currentName = filePath.split('/').pop();

  const content = document.getElementById('content');
  document.getElementById('empty')?.remove();

  // Remember scroll position so live-preview re-renders / theme switches
  // don't jump the reading pane back to the top.
  let scrollRatio = 0;
  if (keepScroll && content.scrollHeight > content.clientHeight) {
    scrollRatio = content.scrollTop / (content.scrollHeight - content.clientHeight);
  }

  const { src, store } = protectMath(source);
  let html = md.render(src);
  html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'id'] });
  html = restoreMath(html, store);

  content.innerHTML = `<article class="markdown-body">${html}</article>`;

  const article = content.querySelector('.markdown-body');
  renderMermaid(article, loadSettings().theme);
  buildToc(article);

  // make external links open in the default browser
  article.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  const nameEl = document.getElementById('doc-name');
  if (nameEl) nameEl.textContent = currentName || '';

  if (keepScroll) {
    const restore = () => {
      const max = content.scrollHeight - content.clientHeight;
      if (max > 0) content.scrollTop = scrollRatio * max;
    };
    // apply now (rAF) and again shortly after async mermaid rendering settles
    requestAnimationFrame(restore);
    setTimeout(restore, 200);
  }

  if (updateRecent && filePath) window.api?.markRecent(filePath);
  renderedSource = source;

  // re-apply an active search highlight after re-render (live preview, theme switch…)
  if (searchTerm && currentMode !== 'edit') {
    requestAnimationFrame(runSearch);
  }
}

/* ---------------- Editing ---------------- */
function setDirty(d) {
  isDirty = d;
  if (activeIndex >= 0 && docs[activeIndex]) docs[activeIndex].dirty = d;
  document.getElementById('dirty-dot')?.classList.toggle('show', d);
  const saveBtn = document.getElementById('btn-file-menu');
  if (saveBtn) saveBtn.classList.toggle('is-dirty', d);
  if (activeIndex >= 0) updateTabDirty(activeIndex, d);
}

function updateDocName() {
  if (currentPath) currentName = currentPath.split('/').pop();
  const nameEl = document.getElementById('doc-name');
  if (nameEl) nameEl.textContent = currentName || '未命名';
}

function setMode(mode) {
  currentMode = mode;
  if (activeIndex >= 0 && docs[activeIndex]) docs[activeIndex].mode = mode;
  else localStorage.setItem('mdr-mode', mode);
  document.body.dataset.mode = mode;

  const editorEl = document.getElementById('editor');
  if (mode === 'split') {
    applySplitWidth();
  } else if (editorEl) {
    // clear any inline flex set by the splitter so edit/read CSS rules apply
    editorEl.style.flex = '';
  }
  if (editorEl && !document.activeElement?.isEqualNode(editorEl)) {
    editorEl.value = currentSource;
  }

  // keep preview in sync when leaving pure-edit mode
  if (mode !== 'edit' && currentSource && currentSource !== renderedSource) {
    renderDocument(currentSource, currentPath, false);
  }

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

function toggleEdit() {
  setMode(currentMode === 'edit' ? 'read' : 'edit');
}

let renderTimer = null;
function scheduleRender() {
  if (currentMode !== 'split') return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    // keepScroll: preserve the reading pane scroll while live-editing
    renderDocument(currentSource, currentPath, false, true);
  }, 350);
}

// The save dialog may return a path without an extension; force `.md`.
function ensureMdExt(p) {
  if (!p) return p;
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(p) ? p : p + '.md';
}

async function doSave() {
  if (!currentPath) return doSaveAs();
  try {
    // Rust `write_file` returns Result<(), String>; Tauri resolves to `null`
    // on success and rejects on failure — do NOT check `res.ok` (always null).
    await window.api?.saveFile(currentPath, currentSource);
    setDirty(false);
    window.api?.markRecent(currentPath);
    showStatus('已保存');
  } catch (e) {
    alert('保存失败：' + (e && e.message ? e.message : e));
  }
}

async function doSaveAs() {
  const result = await window.api?.saveAsDialog(currentPath);
  if (!result || !result.path) return;
  const path = ensureMdExt(result.path);
  try {
    await window.api?.saveFile(path, currentSource);
    currentPath = path;
    currentName = path.split('/').pop();
    if (activeIndex >= 0 && docs[activeIndex]) {
      docs[activeIndex].path = path;
      docs[activeIndex].name = currentName;
    }
    setDirty(false);
    updateDocName();
    renderTabBar();
    window.api?.markRecent(path);
    showStatus('已保存');
  } catch (e) {
    alert('保存失败：' + (e && e.message ? e.message : e));
  }
}

/* ---------------- In-page search ---------------- */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchRoot() {
  return document.querySelector('#content .markdown-body');
}

function clearSearchHits() {
  document.querySelectorAll('mark.mdr-search-hit').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
  matchEls = [];
  curMatch = -1;
}

function updateCount() {
  const countEl = document.getElementById('search-count');
  if (countEl) {
    countEl.textContent = matchEls.length ? `${curMatch + 1}/${matchEls.length}` : '0/0';
  }
}

function highlightCurrent() {
  matchEls.forEach((el, i) => {
    if (el && el.classList) el.classList.toggle('current', i === curMatch);
  });
  const el = matchEls[curMatch];
  if (el && el.scrollIntoView) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function gotoMatch(delta) {
  if (!matchEls.length) return;
  curMatch = (curMatch + delta + matchEls.length) % matchEls.length;
  if (searchMode === 'textarea') {
    selectMatchTextarea();
  } else {
    highlightCurrent();
  }
  updateCount();
}

function selectMatchTextarea() {
  const editor = document.getElementById('editor');
  const mm = matchEls[curMatch];
  if (!editor || !mm) return;
  editor.focus();
  editor.setSelectionRange(mm.start, mm.end);
  const before = (currentSource || '').slice(0, mm.start);
  const line = before.split('\n').length;
  const cs = getComputedStyle(editor);
  const lineHeight = parseInt(cs.lineHeight, 10) || 24;
  const target = (line - 1) * lineHeight - editor.clientHeight / 2;
  editor.scrollTop = Math.max(0, target);
}

function runSearchTextarea(term) {
  searchMode = 'textarea';
  const editor = document.getElementById('editor');
  if (!editor) return;
  const text = currentSource || '';
  let re;
  try {
    re = new RegExp(escapeRegExp(term), searchCase ? 'g' : 'gi');
  } catch {
    return;
  }
  matchEls = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matchEls.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  if (matchEls.length) {
    curMatch = 0;
    selectMatchTextarea();
  }
  updateCount();
}

function runSearch() {
  const term = (searchTerm || '').trim();
  clearSearchHits();
  if (!term) {
    updateCount();
    return;
  }

  // In pure-edit mode there is no rendered preview → search the source directly.
  const root = getSearchRoot();
  if (!root || currentMode === 'edit') {
    runSearchTextarea(term);
    return;
  }

  searchMode = 'html';
  let re;
  try {
    re = new RegExp(escapeRegExp(term), searchCase ? 'g' : 'gi');
  } catch {
    updateCount();
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentNode;
      const tag = p && p.tagName ? p.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'textarea') {
        return NodeFilter.FILTER_REJECT;
      }
      if (p && p.classList && p.classList.contains('mdr-search-hit')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  let n;
  while ((n = walker.nextNode())) targets.push(n);

  for (const textNode of targets) {
    const text = textNode.nodeValue;
    re.lastIndex = 0;
    let m;
    const frag = document.createDocumentFragment();
    let last = 0;
    let found = false;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'mdr-search-hit';
      mark.textContent = m[0];
      frag.appendChild(mark);
      matchEls.push(mark);
      last = m.index + m[0].length;
      found = true;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (found) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  if (matchEls.length) {
    curMatch = 0;
    highlightCurrent();
  }
  updateCount();
}

function openSearch() {
  document.getElementById('search-bar')?.classList.remove('hidden');
  replaceCursor = 0;
  const input = document.getElementById('search-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeSearch() {
  document.getElementById('search-bar')?.classList.add('hidden');
  clearSearchHits();
  searchTerm = '';
  replaceWith = '';
  replaceCursor = 0;
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const rInput = document.getElementById('replace-input');
  if (rInput) rInput.value = '';
  updateCount();
}

/* ---------------- Find & Replace ---------------- */
// Replace always operates on the Markdown SOURCE (currentSource) so the change
// persists and survives re-renders in any mode (read / split / edit).
function sourceReplaceRegex(term) {
  let re;
  try {
    re = new RegExp(escapeRegExp(term), searchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
  return re;
}

function commitReplaced(nextSource) {
  if (nextSource === currentSource) { showStatus('没有可替换的内容'); return false; }
  currentSource = nextSource;
  if (activeIndex >= 0 && docs[activeIndex]) {
    docs[activeIndex].source = currentSource;
    docs[activeIndex].dirty = true;
  }
  setDirty(true);
  renderDocument(currentSource, currentPath, false, true);
  scheduleAutoSave();
  if (searchTerm) requestAnimationFrame(runSearch);
  return true;
}

function replaceAll() {
  const term = (searchTerm || '').trim();
  if (!term) { showStatus('请先输入查找内容'); return; }
  const re = sourceReplaceRegex(term);
  if (!re) return;
  let count = 0;
  const next = currentSource.replace(re, () => { count++; return replaceWith; });
  if (commitReplaced(next)) showStatus(`已替换 ${count} 处`);
}

function replaceOne() {
  const term = (searchTerm || '').trim();
  if (!term) { showStatus('请先输入查找内容'); return; }
  const re = sourceReplaceRegex(term);
  if (!re) return;
  re.lastIndex = replaceCursor;
  const m = re.exec(currentSource || '');
  if (!m) {
    replaceCursor = 0;
    showStatus('已到文末，无更多匹配');
    return;
  }
  const start = m.index;
  const end = start + m[0].length;
  const next = currentSource.slice(0, start) + replaceWith + currentSource.slice(end);
  if (commitReplaced(next)) {
    replaceCursor = start + replaceWith.length;
    showStatus('已替换 1 处');
  }
}

/* ---------------- Export PDF / Word ---------------- */
function ensurePreview() {
  // In pure-edit mode the preview pane is empty; (re)render so there is
  // something to export. Safe to call in any mode.
  if (currentMode === 'edit' || !document.querySelector('#content .markdown-body')) {
    renderDocument(currentSource || '', currentPath, false);
  }
}

function docStem() {
  return (currentName || 'document').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
}

async function doExportPdf() {
  ensurePreview();
  const article = document.querySelector('#content .markdown-body');
  if (!article) {
    showStatus('没有可导出的内容');
    return;
  }
  // html2pdf's default export may be a namespace object depending on bundler
  // interop; normalize to the callable.
  const maker = (typeof html2pdf === 'function') ? html2pdf : (html2pdf && html2pdf.default);
  if (!maker) {
    alert('PDF 导出组件未加载');
    return;
  }
  showStatus('正在生成 PDF…');
  try {
    const opt = {
      margin: 12,
      filename: docStem() + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    };
    const blob = await maker().set(opt).from(article).outputPdf('blob');
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const bytes = Array.from(u8);
    const dlg = await window.api?.saveAsDialog(docStem() + '.pdf');
    if (!dlg || !dlg.path) { showStatus('已取消'); return; }
    await window.api.writeFileBytes(dlg.path, bytes);
    showStatus('已导出 PDF：' + dlg.path.split('/').pop());
  } catch (e) {
    alert('导出 PDF 失败：' + (e && e.message ? e.message : e));
  }
}

async function doExportWord() {
  ensurePreview();
  const article = document.querySelector('#content .markdown-body');
  if (!article) {
    showStatus('没有可导出的内容');
    return;
  }
  const inner = article.innerHTML;
  const full =
    `<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-com:office:office' ` +
    `xmlns:w='urn:schemas-microsoft-com:office:word' ` +
    `xmlns='http://www.w3.org/1999/xhtml'><head><meta charset='utf-8'>` +
    `<title>${docStem()}</title></head><body>${inner}</body></html>`;
  let blob;
  try {
    blob = htmlDocx.asBlob(full);
  } catch (e) {
    alert('生成 Word 失败：' + (e && e.message ? e.message : e));
    return;
  }
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const bytes = Array.from(u8);
  try {
    const dlg = await window.api?.saveAsDialog(docStem() + '.docx');
    if (!dlg || !dlg.path) return;
    await window.api?.writeFileBytes(dlg.path, bytes);
    showStatus('已导出 Word：' + dlg.path.split('/').pop());
  } catch (e) {
    alert('导出 Word 失败：' + (e && e.message ? e.message : e));
  }
}

/* ---------------- Auto save ---------------- */
function scheduleAutoSave() {
  if (!autoSaveEnabled || !currentPath) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        // Rust `write_file` returns Result<(), String>; Tauri resolves to
        // `null` on success — do NOT check `res.ok`.
        await window.api?.saveFile(currentPath, currentSource);
        setDirty(false);
        const t = new Date();
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        showStatus(`已自动保存 ${hh}:${mm}`);
      } catch (e) {
        showStatus('自动保存失败');
      }
    }, 1000);
}

/* ---------------- File reading (drop) ---------------- */
// Dropped files don't expose a local path in the renderer (Electron security),
// so we read their *content* directly via the File API instead of asking the
// main process to fs.readFile a path we don't have.
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.readAsText(file);
  });
}

async function openDroppedFile(file) {
  try {
    const content = await readFileAsText(file);
    // open as a new tab (drop never exposes a local path); doesn't discard others
    openDoc({ path: '', name: file.name || '未命名', content });
  } catch (e) {
    alert('读取文件失败：' + (e && e.message ? e.message : e));
  }
}

/* ---------------- Drag & drop ---------------- */
function setupDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      depth++;
      overlay.classList.add('show');
    }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth--;
    if (depth <= 0) {
      depth = 0;
      overlay.classList.remove('show');
    }
  });
  window.addEventListener('drop', async (e) => {
    if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    const files = Array.from(e.dataTransfer.files);
    const mdFiles = files.filter((f) => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name || ''));
    for (const f of mdFiles) await openDroppedFile(f);
  });
}

/* ---------------- Splitter (resizable columns) ---------------- */
function applySplitWidth() {
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;
  let w = null;
  if (activeIndex >= 0 && docs[activeIndex] && docs[activeIndex].splitWidth) {
    w = docs[activeIndex].splitWidth;
  } else {
    w = localStorage.getItem('mdr-split');
  }
  if (w) editorEl.style.flex = `0 0 ${w}px`;
}

function setupSplitter() {
  const splitter = document.getElementById('splitter');
  const editorEl = document.getElementById('editor');
  const bodyEl = document.querySelector('.body');
  if (!splitter || !editorEl || !bodyEl) return;

  splitter.addEventListener('mousedown', (e) => {
    if (currentMode !== 'split') return;
    e.preventDefault();
    document.body.classList.add('resizing');
    splitter.classList.add('dragging');

    const onMove = (ev) => {
      const rect = editorEl.getBoundingClientRect();
      const minW = 120;
      const maxW = bodyEl.getBoundingClientRect().right - rect.left - 120;
      let w = ev.clientX - rect.left;
      w = Math.max(minW, Math.min(maxW, w));
      editorEl.style.flex = `0 0 ${Math.round(w)}px`;
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      splitter.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const rect = editorEl.getBoundingClientRect();
      localStorage.setItem('mdr-split', String(Math.round(rect.width)));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ---------------- Wiring ---------------- */
function setupFileMenu() {
  const fileMenuBtn = document.getElementById('btn-file-menu');
  const fileMenuPop = document.getElementById('file-menu-pop');
  if (!fileMenuBtn || !fileMenuPop) return;
  fileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileMenuPop.classList.toggle('hidden');
  });
  fileMenuPop.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    e.stopPropagation();
    const action = item.dataset.action;
    if (action === 'save') doSave();
    else if (action === 'save-as') doSaveAs();
    else if (action === 'pdf') doExportPdf();
    else if (action === 'word') doExportWord();
    else if (action === 'theme') cycleTheme();
    fileMenuPop.classList.add('hidden');
  });
  // 点击其他区域关闭菜单
  document.addEventListener('click', () => {
    if (!fileMenuPop.classList.contains('hidden')) fileMenuPop.classList.add('hidden');
  });
}

/* ---------------- Compare (dual-pane diff) ---------------- */
let compareA = null; // doc-like { id?, path, name, source }
let compareB = null;
let compareMode = 'preview'; // 'preview' | 'diff'
let compareOnlyDiff = false;

function docRef(d) {
  return { id: d.id, path: d.path, name: d.name, source: d.source };
}

function openCompare() {
  if (docs.length === 0) {
    alert('请先打开至少一个文档，再使用对比。');
    return;
  }
  const a = docs[activeIndex >= 0 ? activeIndex : 0];
  compareA = docRef(a);
  compareB = docs.length > 1 ? docRef(docs[(activeIndex + 1) % docs.length]) : null;
  document.getElementById('compare-overlay')?.classList.remove('hidden');
  populateCompareSelects();
  renderCompare();
}

function populateCompareSelects() {
  const selA = document.getElementById('cmp-sel-a');
  const selB = document.getElementById('cmp-sel-b');
  if (!selA || !selB) return;
  const optsA = docs.map((d, i) => `<option value="${i}">${escapeHtml(d.name)}</option>`).join('');
  let optsB = docs.map((d, i) => `<option value="${i}">${escapeHtml(d.name)}</option>`).join('');
  if (compareB && !docs.find((d) => d.id === compareB.id)) {
    optsB += `<option value="__transient" selected>${escapeHtml(compareB.name)}</option>`;
  }
  optsB += `<option value="__open">— 打开文件… —</option>`;
  selA.innerHTML = optsA;
  selB.innerHTML = optsB;
  const ai = docs.findIndex((d) => d.id === compareA?.id);
  const bi = compareB ? docs.findIndex((d) => d.id === compareB.id) : -1;
  if (ai >= 0) selA.value = String(ai);
  if (bi >= 0) selB.value = String(bi);
}

function renderMarkdownInto(el, source) {
  const { src, store } = protectMath(source || '');
  let html = md.render(src);
  html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'id'] });
  html = restoreMath(html, store);
  el.innerHTML = `<article class="markdown-body">${html}</article>`;
  const article = el.querySelector('.markdown-body');
  renderMermaid(article, loadSettings().theme);
  article.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
}

// Line-level diff via LCS. Returns ops: {t:'eq'|'del'|'ins', a?, b?}.
function lineDiff(aLines, bLines) {
  const n = aLines.length;
  const m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ t: 'eq', a: aLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', a: aLines[i] });
      i++;
    } else {
      ops.push({ t: 'ins', b: bLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: 'del', a: aLines[i++] });
  while (j < m) ops.push({ t: 'ins', b: bLines[j++] });
  return ops;
}

function renderDiffSplit(aSrc, bSrc, onlyDiff) {
  const aLines = (aSrc || '').split('\n');
  const bLines = (bSrc || '').split('\n');
  const ops = lineDiff(aLines, bLines);
  let htmlA = '';
  let htmlB = '';
  for (const op of ops) {
    if (op.t === 'eq') {
      if (onlyDiff) continue;
      const line = escapeHtml(op.a) || ' ';
      htmlA += `<div class="dln">${line}</div>`;
      htmlB += `<div class="dln">${line}</div>`;
    } else if (op.t === 'del') {
      htmlA += `<div class="dln del">${escapeHtml(op.a) || ' '}</div>`;
      htmlB += `<div class="dln gap"></div>`;
    } else {
      htmlA += `<div class="dln gap"></div>`;
      htmlB += `<div class="dln ins">${escapeHtml(op.b) || ' '}</div>`;
    }
  }
  return { htmlA, htmlB };
}

function renderCompare() {
  const ca = document.getElementById('cmp-content-a');
  const cb = document.getElementById('cmp-content-b');
  if (!ca || !cb) return;
  const onlyWrap = document.getElementById('cmp-onlydiff-wrap');
  if (!compareA || !compareB) {
    ca.className = 'cmp-content';
    cb.className = 'cmp-content';
    ca.innerHTML = '<div class="cmp-empty">请在右侧「打开文件」选择一个对比对象。</div>';
    cb.innerHTML = '';
    return;
  }
  if (compareMode === 'preview') {
    onlyWrap?.classList.add('hidden');
    ca.className = 'cmp-content';
    cb.className = 'cmp-content';
    renderMarkdownInto(ca, compareA.source);
    renderMarkdownInto(cb, compareB.source);
  } else {
    onlyWrap?.classList.remove('hidden');
    ca.className = 'cmp-content cmp-diff-wrap';
    cb.className = 'cmp-content cmp-diff-wrap';
    const { htmlA, htmlB } = renderDiffSplit(compareA.source, compareB.source, compareOnlyDiff);
    ca.innerHTML = `<div class="cmp-diff">${htmlA}</div>`;
    cb.innerHTML = `<div class="cmp-diff">${htmlB}</div>`;
  }
}

function closeCompare() {
  document.getElementById('compare-overlay')?.classList.add('hidden');
}

function setupUI() {
  document.getElementById('btn-open').addEventListener('click', () => window.api?.openDialog());
  // 合并菜单：保存 / 另存为 / 导出 PDF / 导出 Word / 切换主题
  setupFileMenu();
  document.getElementById('btn-toc').addEventListener('click', toggleToc);
  document.getElementById('btn-zoom-in').addEventListener('click', () => setFontSize(loadSettings().fontSize + 1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setFontSize(loadSettings().fontSize - 1));
  document.getElementById('btn-zoom-reset').addEventListener('click', () => setFontSize(17));
  document.getElementById('btn-help-close').addEventListener('click', () => {
    document.getElementById('help-overlay').classList.add('hidden');
  });
  const helpBtn = document.getElementById('btn-help');
  if (helpBtn) helpBtn.addEventListener('click', () => {
    document.getElementById('help-overlay').classList.toggle('hidden');
  });

  // 新建 / 对比
  document.getElementById('btn-new').addEventListener('click', newDoc);
  document.getElementById('btn-compare').addEventListener('click', openCompare);

  // 对比覆盖层交互
  const cmpSelA = document.getElementById('cmp-sel-a');
  const cmpSelB = document.getElementById('cmp-sel-b');
  if (cmpSelA) cmpSelA.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!isNaN(idx) && docs[idx]) { compareA = docRef(docs[idx]); renderCompare(); }
  });
  if (cmpSelB) cmpSelB.addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === '__open') {
      const picked = await window.api?.pickAndRead();
      if (picked) { compareB = picked; }
      populateCompareSelects();
      renderCompare();
    } else if (v !== '__transient') {
      const idx = parseInt(v, 10);
      if (!isNaN(idx) && docs[idx]) { compareB = docRef(docs[idx]); renderCompare(); }
    }
  });
  document.getElementById('cmp-open-b')?.addEventListener('click', async () => {
    const picked = await window.api?.pickAndRead();
    if (picked) { compareB = picked; populateCompareSelects(); renderCompare(); }
  });
  document.querySelectorAll('.cmp-mode').forEach((b) => {
    b.addEventListener('click', () => {
      compareMode = b.dataset.mode;
      document.querySelectorAll('.cmp-mode').forEach((x) => x.classList.toggle('active', x === b));
      renderCompare();
    });
  });
  document.getElementById('cmp-onlydiff')?.addEventListener('change', (e) => {
    compareOnlyDiff = e.target.checked;
    renderCompare();
  });
  document.getElementById('cmp-close')?.addEventListener('click', closeCompare);
  // 导出按钮已合并进「文件 ▾」菜单（见 setupFileMenu）

  // ---- search (Cmd/Ctrl+F) ----
  const sInput = document.getElementById('search-input');
  const sPrev = document.getElementById('search-prev');
  const sNext = document.getElementById('search-next');
  const sClose = document.getElementById('search-close');
  const sCase = document.getElementById('search-case');
  const rInput = document.getElementById('replace-input');
  const rOne = document.getElementById('replace-one');
  const rAll = document.getElementById('replace-all');
  if (sInput) {
    sInput.addEventListener('input', () => { searchTerm = sInput.value; replaceCursor = 0; runSearch(); });
    sInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });
  }
  if (sPrev) sPrev.addEventListener('click', () => gotoMatch(-1));
  if (sNext) sNext.addEventListener('click', () => gotoMatch(1));
  if (sClose) sClose.addEventListener('click', closeSearch);
  if (sCase) sCase.addEventListener('change', (e) => { searchCase = e.target.checked; replaceCursor = 0; runSearch(); });
  if (rInput) {
    rInput.addEventListener('input', () => { replaceWith = rInput.value; });
    rInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });
  }
  if (rOne) rOne.addEventListener('click', replaceOne);
  if (rAll) rAll.addEventListener('click', replaceAll);

  // font chooser (display settings inside help panel)
  const selBody = document.getElementById('sel-font-body');
  const selCode = document.getElementById('sel-font-code');
  const st = loadSettings();
  if (selBody) {
    selBody.value = st.fontBody;
    selBody.addEventListener('change', () => { localStorage.setItem('mdr-font-body', selBody.value); applySettings(); });
  }
  if (selCode) {
    selCode.value = st.fontCode;
    selCode.addEventListener('change', () => { localStorage.setItem('mdr-font-code', selCode.value); applySettings(); });
  }
  const selWidth = document.getElementById('sel-content-width');
  if (selWidth) {
    selWidth.value = st.contentWidth;
    selWidth.addEventListener('change', () => { localStorage.setItem('mdr-content-width', selWidth.value); applySettings(); });
  }
  const selMode = document.getElementById('sel-default-mode');
  if (selMode) {
    selMode.value = st.defaultMode;
    selMode.addEventListener('change', () => { localStorage.setItem('mdr-default-mode', selMode.value); });
  }

  // click-to-link buttons (split mode only)
  document.getElementById('btn-locate-preview').addEventListener('click', () => {
    if (currentMode !== 'split') return;
    locatePreviewToLine(caretLine(editorEl));
  });
  document.getElementById('btn-locate-edit').addEventListener('click', () => {
    if (currentMode !== 'split') return;
    locateEditorToLine(topVisibleSourceLine());
  });

  // editing
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
  const editorEl = document.getElementById('editor');
  editorEl.addEventListener('input', () => {
    currentSource = editorEl.value;
    setDirty(true);
    scheduleRender();
    scheduleAutoSave();
  });

  // ---- click-to-link between editor and preview (split mode only) ----
  editorEl.addEventListener('dblclick', () => {
    if (currentMode !== 'split') return;
    locatePreviewToLine(caretLine(editorEl));
  });
  const contentEl = document.getElementById('content');
  contentEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-source-line]');
    if (!el) return;
    if (currentMode === 'split') {
      locateEditorToLine(parseInt(el.dataset.sourceLine, 10));
    } else if (currentMode === 'read') {
      beginInlineEdit(el);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    if (currentMode !== 'split') return;
    if (document.activeElement === editorEl) {
      locatePreviewToLine(caretLine(editorEl));
    } else if (contentEl.contains(document.activeElement)) {
      const sel = window.getSelection();
      let el = null;
      if (sel && sel.anchorNode && contentEl.contains(sel.anchorNode)) {
        const node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        el = node.closest ? node.closest('[data-source-line]') : null;
      }
      el = el || contentEl.querySelector('[data-source-line]');
      if (el) locateEditorToLine(parseInt(el.dataset.sourceLine, 10));
    }
    e.preventDefault();
  });

  window.api?.onOpenFile((data) => {
    openDoc(data); // { path, name, content } — focus existing tab or open a new one
  });
  window.api?.onZoom((dir) => {
    if (dir === 'in') setFontSize(loadSettings().fontSize + 1);
    else if (dir === 'out') setFontSize(loadSettings().fontSize - 1);
    else setFontSize(17);
  });
  window.api?.onToggleTheme(cycleTheme);
  window.api?.onToggleToc(toggleToc);
  window.api?.onShowHelp(() => document.getElementById('help-overlay').classList.toggle('hidden'));
  window.api?.onSave(doSave);
  window.api?.onSaveAs(doSaveAs);
  window.api?.onExportPdf(doExportPdf);
  window.api?.onExportWord(doExportWord);
  window.api?.onToggleEdit(toggleEdit);
  window.api?.onSetMode(setMode);
  window.api?.onFind(openSearch);
  window.api?.onNewDoc(newDoc);

  // Tab-strip drag tracking: a tab released outside the strip is torn off.
  const tabbarEl = document.getElementById('tabbar');
  if (tabbarEl) {
    tabbarEl.addEventListener('dragover', (e) => {
      if (Array.from(e.dataTransfer.types).includes('text/mdr-tab')) {
        e.preventDefault();
        tabOverBar = true;
      }
    });
    tabbarEl.addEventListener('dragleave', () => { tabOverBar = false; });
    tabbarEl.addEventListener('drop', (e) => {
      if (Array.from(e.dataTransfer.types).includes('text/mdr-tab')) {
        e.preventDefault();
        e.stopPropagation();
        tabOverBar = true; // dropped on the strip → keep (no reorder)
      }
    });
  }

  // global Cmd/Ctrl+F → open search
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openSearch();
    }
  });

  // Esc closes the compare overlay when it is open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('compare-overlay')?.classList.contains('hidden')) {
      e.preventDefault();
      closeCompare();
    }
  });
}

applySettings();
setupUI();
setupDragDrop();
setupSplitter();
setMode(loadSettings().defaultMode);
renderTabBar(); // initial empty state: keep the bar hidden

// A freshly opened detached window claims the file path parked for its label.
const inTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
if (inTauri) window.api?.takeInitialFile();

// expose for debugging / external triggers
window.__mdr = {
  renderDocument, setMode, doSave, doSaveAs, scheduleAutoSave,
  openDoc, closeDoc, activateDoc, getDocs: () => docs, getActive: () => activeIndex,
};
