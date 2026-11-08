/**
 * 静态检查：manifest 完整性、文件引用、MV3 CSP、编码规范
 * 运行：node test/lint.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('[通过] ' + name);
  } catch (err) {
    fail += 1;
    console.log('[失败] ' + name);
    console.log('       ' + err.message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));

check('manifest 为 MV3 且包含必要字段', () => {
  assert(manifest.manifest_version === 3, 'manifest_version 必须是 3');
  assert(manifest.name && manifest.version, '缺少 name 或 version');
  assert(manifest.action && manifest.action.default_popup, '缺少 action.default_popup');
  assert(manifest.options_ui && manifest.options_ui.page, '缺少 options_ui.page');
});

check('manifest 与 package.json 的版本号一致', () => {
  const pkg = JSON.parse(read('package.json'));
  // 版本号只有一个权威来源：manifest.json（商店读它，pack 脚本按它命名）。
  // 但它和 package.json 不同步时最难发现，所以这里卡住。
  assert(
    pkg.version === manifest.version,
    'manifest ' + manifest.version + ' 与 package.json ' + pkg.version + ' 不一致'
  );
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), '版本号应为 x.y.z：' + manifest.version);
});

check('manifest 声明的所有文件都真实存在', () => {
  const files = [];
  (manifest.content_scripts || []).forEach((cs) => {
    (cs.js || []).forEach((f) => files.push(f));
    (cs.css || []).forEach((f) => files.push(f));
  });
  Object.values(manifest.icons || {}).forEach((f) => files.push(f));
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((f) => files.push(f));
  files.push(manifest.action.default_popup);
  files.push(manifest.options_ui.page);

  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert(missing.length === 0, '缺少文件：' + missing.join(', '));
});

check('content script 在 document_start 注入，避免先白后黑', () => {
  const cs = (manifest.content_scripts || [])[0];
  assert(cs, '没有 content_scripts');
  assert(cs.run_at === 'document_start', 'run_at 实际为 ' + cs.run_at);
  assert(cs.js.indexOf('src/shared.js') === 0, 'shared.js 必须先于 dark.js 加载');
  assert(cs.js.indexOf('src/dark.js') === 1, 'dark.js 应在 shared.js 之后');
});

check('权限最小化：只申请 storage 与 activeTab', () => {
  const perms = manifest.permissions || [];
  assert(
    perms.length === 2 && perms.indexOf('storage') >= 0 && perms.indexOf('activeTab') >= 0,
    '实际权限：' + JSON.stringify(perms)
  );
});

check('HTML 中没有内联脚本（MV3 CSP 会拦截）', () => {
  for (const f of ['src/popup.html', 'src/options.html']) {
    const html = read(f);
    const inline = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html);
    assert(!inline, f + ' 里存在内联 script');
  }
});

check('HTML 引用的 css/js 文件都存在', () => {
  for (const f of ['src/popup.html', 'src/options.html']) {
    const html = read(f);
    const dir = path.dirname(path.join(ROOT, f));
    const refs = [];
    html.replace(/(?:src|href)="([^"]+)"/g, (m, p) => {
      if (!/^https?:|^data:/.test(p)) refs.push(p);
      return m;
    });
    const missing = refs.filter((r) => !fs.existsSync(path.join(dir, r)));
    assert(missing.length === 0, f + ' 缺少：' + missing.join(', '));
  }
});

check('源码与文档中不含 emoji 及装饰性符号', () => {
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/u;
  const targets = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (name === 'node_modules' || name === 'artifacts' || name === '.git') continue;
        walk(full);
      } else if (/\.(js|json|html|css|py|md)$/.test(name)) {
        targets.push(full);
      }
    }
  };
  walk(ROOT);

  const bad = [];
  for (const file of targets) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(emoji);
      if (m) bad.push(path.relative(ROOT, file) + ':' + (i + 1) + ' -> ' + m[0]);
    });
  }
  assert(bad.length === 0, '发现 ' + bad.length + ' 处：\n       ' + bad.slice(0, 8).join('\n       '));
});

check('没有引用未定义的全局变量（粗查手误）', () => {
  for (const f of ['src/shared.js', 'src/dark.js', 'src/popup.js', 'src/options.js']) {
    const code = read(f);
    assert(!/\bconsole\.log\b/.test(code), f + ' 里残留了调试日志');
  }
});

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
