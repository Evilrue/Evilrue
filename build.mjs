/**
 * 把 public/index.html 内联进 src/worker.js，输出单文件 dist/worker.js
 * 这样既可以用 wrangler deploy 部署，也可以直接粘贴到 Cloudflare 面板里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const template = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');

if (!template.includes('"__PAGE__"')) {
  console.error('src/worker.js 里找不到 "__PAGE__" 占位符');
  process.exit(1);
}

const bundled = template.replace('"__PAGE__"', JSON.stringify(html));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'worker.js'), bundled);
console.log(`dist/worker.js 生成完成（${(bundled.length / 1024).toFixed(1)} KB，页面 ${(html.length / 1024).toFixed(1)} KB）`);
