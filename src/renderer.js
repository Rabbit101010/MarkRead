import './api.js'; // Tauri bridge: exposes window.api (replaces Electron preload)
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

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
    if (t.map) t.attrSet('data-source-line', String(t.map[0]));
    return original(tokens, idx, options, env, self);
  };
}
['paragraph_open', 'heading_open', 'blockquote_open', 'bullet_list_open',
 'ordered_list_open', 'list_item_open', 'table_open', 'thead_open', 'tbody_open',
 'tr_open', 'hr', 'dl_open', 'dt_open', 'dd_open'].forEach(tagSourceLine);
const origFence = md.renderer.rules.fence || defaultRender;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (t.map) t.attrSet('data-source-line', String(t.map[0]));
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

let autoSaveEnabled = localStorage.getItem('mdr-autosave') !== 'false';
let autoSaveTimer = null;
let statusTimer = null;

function loadSettings() {
  return {
    theme: localStorage.getItem('mdr-theme') || 'light',
    fontSize: parseInt(localStorage.getItem('mdr-fontsize') || '17', 10),
    tocOpen: localStorage.getItem('mdr-toc') !== 'false',
  };
}

function applySettings() {
  const s = loadSettings();
  document.body.className = `theme-${s.theme}`;
  document.documentElement.style.setProperty('--reader-font-size', s.fontSize + 'px');
  document.getElementById('toc').classList.toggle('open', s.tocOpen);
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
  const open = !document.getElementById('toc').classList.contains('open');
  localStorage.setItem('mdr-toc', String(open));
  document.getElementById('toc').classList.toggle('open', open);
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
}

/* ---------------- Editing ---------------- */
function setDirty(d) {
  isDirty = d;
  document.getElementById('dirty-dot')?.classList.toggle('show', d);
  const saveBtn = document.getElementById('btn-save');
  if (saveBtn) saveBtn.classList.toggle('is-dirty', d);
}

function updateDocName() {
  if (currentPath) currentName = currentPath.split('/').pop();
  const nameEl = document.getElementById('doc-name');
  if (nameEl) nameEl.textContent = currentName || '未命名';
}

function setMode(mode) {
  currentMode = mode;
  localStorage.setItem('mdr-mode', mode);
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

async function doSave() {
  if (!currentPath) return doSaveAs();
  const res = await window.api?.saveFile(currentPath, currentSource);
  if (res && res.ok) {
    setDirty(false);
    window.api?.markRecent(currentPath);
    showStatus('已保存');
  } else if (res && res.error) {
    alert('保存失败：' + res.error);
  }
}

async function doSaveAs() {
  const result = await window.api?.saveAsDialog(currentPath);
  if (!result || !result.path) return;
  const res = await window.api?.saveFile(result.path, currentSource);
  if (res && res.ok) {
    currentPath = result.path;
    setDirty(false);
    updateDocName();
    window.api?.markRecent(currentPath);
    showStatus('已保存');
  } else if (res && res.error) {
    alert('保存失败：' + res.error);
  }
}

/* ---------------- Auto save ---------------- */
function scheduleAutoSave() {
  if (!autoSaveEnabled || !currentPath) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const res = await window.api?.saveFile(currentPath, currentSource);
    if (res && res.ok) {
      setDirty(false);
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      showStatus(`已自动保存 ${hh}:${mm}`);
    } else if (res && res.error) {
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
  if (isDirty && !confirm('当前文档有未保存的修改，确定要打开新文件并丢弃吗？')) return;
  try {
    const content = await readFileAsText(file);
    currentName = file.name || '未命名';
    renderDocument(content, ''); // no path => Save will prompt "另存为"
    setDirty(false);
    updateDocName();
    setMode(currentMode);
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
  const saved = localStorage.getItem('mdr-split');
  if (saved) editorEl.style.flex = `0 0 ${saved}px`;
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
function setupUI() {
  document.getElementById('btn-open').addEventListener('click', () => window.api?.openDialog());
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-save-as').addEventListener('click', doSaveAs);
  document.getElementById('btn-theme').addEventListener('click', cycleTheme);
  document.getElementById('btn-toc').addEventListener('click', toggleToc);
  document.getElementById('btn-zoom-in').addEventListener('click', () => setFontSize(loadSettings().fontSize + 1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setFontSize(loadSettings().fontSize - 1));
  document.getElementById('btn-zoom-reset').addEventListener('click', () => setFontSize(17));
  document.getElementById('btn-help-close').addEventListener('click', () => {
    document.getElementById('help-overlay').classList.add('hidden');
  });

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
    if (currentMode !== 'split') return;
    const el = e.target.closest('[data-source-line]');
    if (el) locateEditorToLine(parseInt(el.dataset.sourceLine, 10));
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
    if (isDirty && !confirm('当前文档有未保存的修改，确定要打开新文件并丢弃吗？')) return;
    renderDocument(data.content, data.path);
    setDirty(false);
    updateDocName();
    setMode(currentMode);
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
  window.api?.onToggleEdit(toggleEdit);
  window.api?.onSetMode(setMode);
}

applySettings();
setupUI();
setupDragDrop();
setupSplitter();
setMode(localStorage.getItem('mdr-mode') || 'read');

// expose for debugging / external triggers
window.__mdr = { renderDocument, setMode, doSave, doSaveAs, scheduleAutoSave };
