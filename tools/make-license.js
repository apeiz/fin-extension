/**
 * 授权码批量生成
 *
 * 生成的码与扩展里 licValid 用的是同一套算法（直接加载 src/shared.js，
 * 不复制实现，避免两边算法漂移导致「发出去的码激活不了」）。
 *
 * 用法：
 *   node tools/make-license.js 100           生成 100 个，带分隔符，一行一个
 *   node tools/make-license.js 100 --raw     不带分隔符
 *   node tools/make-license.js 100 --out codes.txt
 *
 * 生成后粘进爱发电的「自动随机回复」，一行一个；用户赞助后系统自动私信发码。
 * 库存发完平台会提醒，再来跑一次即可。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'shared.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

const SD = sandbox.window.SiteDark;
if (!SD || typeof SD.licMake !== 'function') {
  console.error('[异常] shared.js 里没有 licMake，版本不匹配');
  process.exit(1);
}

// 字母表从 shared.js 取，不在这里另写一份 —— 两份不一致会让发出去的码激活不了
const ALPHA = SD.LIC_ALPHA;
if (!ALPHA || ALPHA.length !== 32) {
  console.error('[异常] LIC_ALPHA 长度是 ' + (ALPHA ? ALPHA.length : 0) + '，应为 32');
  process.exit(1);
}

function randomBody() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
  return s;
}

function main() {
  const args = process.argv.slice(2);
  let count = 20;
  let raw = false;
  let out = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--raw') raw = true;
    else if (a === '--out') out = args[++i] || '';
    else if (/^\d+$/.test(a)) count = parseInt(a, 10);
  }

  if (!(count > 0)) {
    console.error('[异常] 数量必须是正整数');
    process.exit(1);
  }
  // 8 位 base32 的空间足够大，但批量生成仍要去重，避免撞码
  if (count > 100000) {
    console.error('[异常] 单次最多 100000 个');
    process.exit(1);
  }

  const seen = new Set();
  const codes = [];
  let guard = 0;
  while (codes.length < count) {
    if (++guard > count * 50) {
      console.error('[异常] 去重时反复碰撞，降低数量重试');
      process.exit(1);
    }
    const body = randomBody();
    if (seen.has(body)) continue;
    seen.add(body);
    const code = SD.licMake(body);
    codes.push(raw ? code : SD.licFormat(code));
  }

  const text = codes.join('\n') + '\n';
  if (out) {
    fs.writeFileSync(out, text, 'utf8');
    console.log('[完成] ' + codes.length + ' 个码已写入 ' + out);
  } else {
    process.stdout.write(text);
  }
  console.error('[提示] 码不绑定设备，换电脑可继续用；发完记得回爱发电补库存');
}

main();
