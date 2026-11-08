/**
 * 授权码批量生成
 *
 * 生成的码与扩展里 licValid 用的是同一套算法（直接加载 src/shared.js，
 * 不复制实现，避免两边算法漂移导致「发出去的码激活不了」）。
 *
 * 用法：
 *   node tools/make-license.js 100             生成 100 个，打印并落盘到 licenses/
 *   node tools/make-license.js 100 --no-save   只打印，不落盘
 *   node tools/make-license.js 100 --raw       不带分隔符（用户手输时用得到）
 *   node tools/make-license.js --check <码>    校验一个码是否合法
 *   node tools/make-license.js --stock         看已生成批次与总数
 *
 * 发码流程：生成 -> 全选复制 -> 粘进爱发电「自动随机回复」（一行一个）。
 * 爱发电是该行只发一次、发完不再发，所以剩余数量见底时不会再给码，要及时补。
 *
 * 台账文件 licenses/ 里含可用的码，已在 .gitignore 排除，不要提交、不要外发。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'shared.js');
const DIR = path.join(ROOT, 'licenses');
const LEDGER = path.join(DIR, 'ledger.tsv');

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

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes())
  );
}

function randomBody() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
  return s;
}

/** 校验单个码：格式、分隔符、校验位 */
function check(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    console.error('[异常] 请给出要校验的码，例如 --check ABCD-EFGH-JKMN');
    process.exit(1);
  }
  const clean = input.replace(/[\s-]/g, '').toUpperCase();
  const ok = SD.licValid(clean);
  console.log('输入        : ' + input);
  console.log('归一化      : ' + clean + '（' + clean.length + ' 位，应为 12 位）');
  console.log('显示格式    : ' + (clean.length === 12 ? SD.licFormat(clean) : '长度不对，无法格式化'));
  console.log('校验结果    : ' + (ok ? '通过，可以直接用' : '不通过'));
  if (!ok) {
    console.log('');
    console.log('不通过的常见原因，按可能性排序：');
    console.log('  1. 手抄丢了字符，或把 0/O、1/I 抄错（字母表里没有 I L O 0 1）');
    console.log('  2. 复制时带进了中文标点或空格');
    console.log('  3. 这枚码不是本工具生成的（或来自旧的 secret）');
  }
  process.exit(ok ? 0 : 1);
}

/** 列出已生成的批次 */
function stock() {
  if (!fs.existsSync(LEDGER)) {
    console.log('还没有生成记录（' + LEDGER + ' 不存在）');
    return;
  }
  const lines = fs
    .readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  let total = 0;
  console.log('时间                数量   文件                                  首码');
  console.log('-'.repeat(96));
  for (const line of lines) {
    const [time, count, file, first] = line.split('\t');
    total += parseInt(count, 10) || 0;
    console.log(
      time.padEnd(19) + '  ' + String(count).padStart(4) + '   ' + file.padEnd(36) + '  ' + (first || '')
    );
  }
  console.log('-'.repeat(96));
  console.log('累计 ' + lines.length + ' 批，共 ' + total + ' 个码');
  console.log('注意：这里统计的是「生成过多少」，不是「还剩多少」。');
  console.log('剩余数量以爱发电赞助方案保存后右上角显示的数字为准。');
}

function generate(count, raw, save) {
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
  process.stdout.write(text);

  if (save) {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const file = 'codes-' + stamp(new Date()) + '-' + count + '.txt';
    const full = path.join(DIR, file);
    fs.writeFileSync(full, text, 'utf8');

    const head = fs.existsSync(LEDGER) ? '' : '# 时间\t数量\t文件\t首码\n';
    // 用本地时间，和文件名里的时间戳保持一致，否则对账时会差 8 小时
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const time =
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    fs.appendFileSync(LEDGER, head + [time, count, file, codes[0]].join('\t') + '\n', 'utf8');

    console.error('');
    console.error('[完成] ' + count + ' 个码已写入 ' + full);
    console.error('[台账] ' + LEDGER);
  }

  console.error('');
  console.error('[下一步] 全选上面的码，粘进爱发电赞助方案的「添加自动随机回复」，一行一个');
  console.error('[提醒] 码不绑定设备，换电脑可继续用；剩余数量见底前记得回来补一批');
}

function main() {
  const args = process.argv.slice(2);
  let count = 20;
  let raw = false;
  let save = true;
  let mode = 'make';
  let target = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--raw') raw = true;
    else if (a === '--no-save') save = false;
    else if (a === '--check') {
      mode = 'check';
      target = args[++i] || '';
    } else if (a === '--stock') mode = 'stock';
    else if (/^\d+$/.test(a)) count = parseInt(a, 10);
  }

  if (mode === 'check') return check(target);
  if (mode === 'stock') return stock();
  return generate(count, raw, save);
}

main();
