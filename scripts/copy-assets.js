// Copies static frontend assets into dist/ so Tauri can serve them.
// Uses copyFileSync (in-place overwrite, no unlink) instead of cpSync so the
// build does not trip sandbox policies that block unlinking existing files.
const fs = require('fs');
const path = require('path');

const pairs = [
  ['index.html', 'dist/index.html'],
  ['src/styles', 'dist/styles'],
  ['vendor', 'dist/vendor'],
  ['fonts', 'dist/fonts'],
];

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst); // overwrites in place — no unlink
}

function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    copyFile(src, dst);
  }
}

for (const [src, dst] of pairs) {
  const from = path.join(__dirname, '..', src);
  const to = path.join(__dirname, '..', dst);
  if (fs.statSync(from).isDirectory()) {
    copyTree(from, to);
  } else {
    copyFile(from, to);
  }
}
console.log('frontend assets copied to dist/');
