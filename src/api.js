// Tauri bridge: implements the `window.api` object that renderer.js expects
// (previously provided by an Electron preload script). Backed by @tauri-apps.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

const handlers = {
  openFile: [],
  zoom: [],
  toggleTheme: [],
  toggleToc: [],
  showHelp: [],
  save: [],
  saveAs: [],
  exportPdf: [],
  exportWord: [],
  toggleEdit: [],
  setMode: [],
  find: [],
};

function fire(name, arg) {
  (handlers[name] || []).forEach((cb) => {
    try {
      cb(arg);
    } catch (e) {
      console.error('api handler error', e);
    }
  });
}

async function openViaDialog() {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (!selected) return;
    const content = await invoke('read_file', { path: selected });
    fire('openFile', { path: selected, name: String(selected).split('/').pop(), content });
  } catch (e) {
    console.error('open failed', e);
  }
}

async function openByPath(path) {
  try {
    const content = await invoke('read_file', { path });
    fire('openFile', { path, name: String(path).split('/').pop(), content });
  } catch (e) {
    console.error('open by path failed', e);
  }
}

async function saveViaDialog(defaultPath) {
  const p = await save({ defaultPath });
  return p ? { path: p } : null;
}

// The renderer calls these exactly as it did with the Electron preload.
window.api = {
  openDialog: () => {
    openViaDialog();
  },
  saveFile: (path, content) => invoke('write_file', { path, content }),
  saveFileBytes: (path, bytes) => invoke('write_file_bytes', { path, bytes }),
  saveAsDialog: (defaultPath) => saveViaDialog(defaultPath),
  markRecent: (path) => {
    if (path) invoke('add_recent', { path });
  },
  onOpenFile: (cb) => handlers.openFile.push(cb),
  onZoom: (cb) => handlers.zoom.push(cb),
  onToggleTheme: (cb) => handlers.toggleTheme.push(cb),
  onToggleToc: (cb) => handlers.toggleToc.push(cb),
  onShowHelp: (cb) => handlers.showHelp.push(cb),
  onSave: (cb) => handlers.save.push(cb),
  onSaveAs: (cb) => handlers.saveAs.push(cb),
  onExportPdf: (cb) => handlers.exportPdf.push(cb),
  onExportWord: (cb) => handlers.exportWord.push(cb),
  onToggleEdit: (cb) => handlers.toggleEdit.push(cb),
  onSetMode: (cb) => handlers.setMode.push(cb),
  onFind: (cb) => handlers.find.push(cb),
};

// Menu actions are emitted from the Rust shell as a single 'menu' event.
const inTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
if (inTauri) {
  // Register listeners BEFORE telling Rust we are ready. `listen` and
  // `invoke` are both async; if `mark_ready` ran before the `open-file`
  // listener was registered, the cold-start `open-file` event flushed by
  // `mark_ready` would be emitted into a void and dropped — so the first
  // double-click on a .md opened the app but not the document. Awaiting the
  // listeners first guarantees the front-end is listening before the flush.
  (async () => {
    await listen('menu', (event) => {
      const { action, arg } = event.payload || {};
      switch (action) {
        case 'open':
          openViaDialog();
          break;
        case 'save':
          fire('save');
          break;
        case 'save-as':
          fire('saveAs');
          break;
        case 'export-pdf':
          fire('exportPdf');
          break;
        case 'export-word':
          fire('exportWord');
          break;
        case 'zoom':
          fire('zoom', arg);
          break;
        case 'toggle-theme':
          fire('toggleTheme');
          break;
        case 'toggle-toc':
          fire('toggleToc');
          break;
        case 'toggle-edit':
          fire('toggleEdit');
          break;
        case 'set-mode':
          fire('setMode', arg);
          break;
        case 'show-help':
          fire('showHelp');
          break;
        case 'find':
          fire('find');
          break;
        case 'recent':
          if (arg) openByPath(arg);
          break;
        default:
          break;
      }
    });

    await listen('open-file', (event) => {
      openByPath(event.payload);
    });

    // Now signal readiness so any file captured during cold start is flushed.
    await invoke('mark_ready');
  })().catch((e) => console.error('tauri listener init failed', e));
}
