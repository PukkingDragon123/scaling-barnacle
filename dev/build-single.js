// Bundles the game into one self-contained HTML file: dist/otto-clam-farm.html
//
// No dependencies. Inlines every js/ file in load order into a single <script>,
// so the result runs from a file:// path, a USB stick, or any static host.
//
//   node dev/build-single.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// take the script load order straight from index.html so the two can't drift
const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!order.length) throw new Error('no <script src> tags found in index.html');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<script/);
const style = styleMatch ? styleMatch[1].trim() : '';
const body = bodyMatch ? bodyMatch[1].trim() : '<div id="wrap"><canvas id="game" width="480" height="270"></canvas></div>';

const parts = order.map((src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  // each source file has its own 'use strict'; concatenating them into one
  // script is fine, but strip the redundant directives past the first.
  return `\n/* ===== ${src} ===== */\n${code.replace(/^'use strict';\n/m, '')}`;
});

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mr. Otto's Clam Farm</title>
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<style>
${style}
</style>
</head>
<body>
${body}
<script>
'use strict';
${parts.join('')}
</script>
</body>
</html>
`;

const dist = path.join(ROOT, 'dist');
fs.mkdirSync(dist, { recursive: true });

function emit(name, content) {
  const target = path.join(dist, name);
  fs.writeFileSync(target, content);
  console.log(`wrote ${path.relative(ROOT, target)} (${(content.length / 1024).toFixed(1)} KB)`);
}

// 1. standalone: full document, opens from anywhere
emit('otto-clam-farm.html', out);

// 2. embedded: page-content only (no doctype/html/head/body) for hosts that
//    wrap the fragment themselves, with the dive-console shell around it.
const shell = fs.readFileSync(path.join(__dirname, 'artifact-shell.html'), 'utf8');
if (!shell.includes('<!--GAME_SCRIPT-->')) throw new Error('artifact-shell.html lost its <!--GAME_SCRIPT--> placeholder');
emit('otto-clam-farm.embed.html', shell.replace('<!--GAME_SCRIPT-->', `'use strict';\n${parts.join('')}`));

console.log(`${order.length} sources inlined`);
