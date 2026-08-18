// Copies static frontend assets into dist/ so Tauri can serve them.
const fs = require('fs');
const path = require('path');

const pairs = [
  ['index.html', 'dist/index.html'],
  ['src/styles', 'dist/styles'],
  ['vendor', 'dist/vendor'],
  ['fonts', 'dist/fonts'],
];

for (const [src, dst] of pairs) {
  const from = path.join(__dirname, '..', src);
  const to = path.join(__dirname, '..', dst);
  fs.cpSync(from, to, { recursive: true });
}
console.log('frontend assets copied to dist/');
