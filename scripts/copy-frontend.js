// Copies the built frontend (dist/) into the Tauri app bundle's Resources.
// Needed because Tauri's own frontendDist copy can fail silently when the
// project path contains spaces (e.g. "Vibe Coding"): the internal copy
// command does not quote the path. Node's fs handles spaces correctly, so we
// do it explicitly after `tauri build`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) {
  console.error('dist/ not found — run `npm run build:front` first');
  process.exit(1);
}

const macRes = path.join(
  root, 'src-tauri', 'target', 'release', 'bundle', 'macos',
  'MarkRead.app', 'Contents', 'Resources'
);

if (fs.existsSync(macRes)) {
  fs.cpSync(dist, macRes, { recursive: true });
  console.log('frontend + fonts copied into macOS app bundle');
} else {
  // Windows/Linux builds bundle into an installer (msi/deb), not an extracted
  // Resources dir; rely on tauri's own copy there (CI paths have no spaces).
  console.log('macOS app bundle not found (non-macOS build?) — skipping manual copy');
}
