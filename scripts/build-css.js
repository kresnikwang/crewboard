/* Build the same CSS entrypoints used by the SPA and production deploy. */
const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'public/css/dist');
fs.mkdirSync(outputDir, { recursive: true });
for (const name of ['style', 'bootstrap-bridge']) {
  const result = new CleanCSS({ rebaseTo: outputDir }).minify([path.join(root, 'public/css', name + '.css')]);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  fs.writeFileSync(path.join(outputDir, name + '.min.css'), result.styles);
}
console.log('CSS assets built.');
