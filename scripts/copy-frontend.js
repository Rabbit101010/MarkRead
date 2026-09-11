// Copies the built frontend (dist/) into the Tauri app bundle's Resources.
// Needed because Tauri's own frontendDist copy can fail silently when the
// project path contains spaces (e.g. "Vibe Coding"): the internal copy
// command does not quote the path. Node's fs handles spaces correctly, so we
// do it explicitly after `tauri build`.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Recursive copy that overwrites files in place (copyFileSync) instead of
// unlinking first (cpSync). Avoids sandbox policies that block unlinking
// existing files in the bundle.
function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(dist)) {
  console.error('dist/ not found — run `npm run build:front` first');
  process.exit(1);
}

const app = path.join(
  root, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'MarkRead.app'
);
const macRes = path.join(app, 'Contents', 'Resources');

if (fs.existsSync(macRes)) {
  copyTree(dist, macRes);
  console.log('frontend + fonts copied into macOS app bundle');
  // Tauri signs the bundle BEFORE this copy runs, so the signature is now
  // stale. Re-sign ad-hoc so Gatekeeper accepts the app on macOS (no dev
  // cert on local machines; CI uses its own signing). Without this, the app
  // either refuses to launch or silently loads a mismatched/cached frontend.
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
      console.log('ad-hoc re-signed macOS app bundle');
    } catch (e) {
      console.warn('codesign failed (non-fatal):', e.message);
    }
  }
} else {
  // Windows/Linux builds bundle into an installer (msi/deb), not an extracted
  // Resources dir; rely on tauri's own copy there (CI paths have no spaces).
  console.log('macOS app bundle not found (non-macOS build?) — skipping manual copy');
}
