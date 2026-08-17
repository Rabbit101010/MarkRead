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
  toggleEdit: [],
  setMode: [],
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
  onToggleEdit: (cb) => handlers.toggleEdit.push(cb),
  onSetMode: (cb) => handlers.setMode.push(cb),
};

// Menu actions are emitted from the Rust shell as a single 'menu' event.
const inTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
if (inTauri) {
  listen('menu', (event) => {
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
      case 'recent':
        if (arg) openByPath(arg);
        break;
      default:
        break;
    }
  }).catch((e) => console.error('listen menu failed', e));

  // Files opened from Finder / "Open with" are delivered by the Rust shell as
  // an 'open-file' event carrying the absolute path.
  listen('open-file', (event) => {
    openByPath(event.payload);
  }).catch((e) => console.error('listen open-file failed', e));

  // Tell the Rust shell the renderer is ready so any pending file-open
  // requests captured during cold start get flushed to us.
  invoke('mark_ready').catch((e) => console.error('mark_ready failed', e));
}
