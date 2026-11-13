/**
 * 爱发电订单查询与发码对账
 *
 * 用来解决一件事：读者在爱发电付款之后，得有人把授权码发过去。
 * 平台能自动发码的通道是「自动随机回复」，它要创作者认证；认证下来之前只能人工发。
 * 人工最容易出两种错，漏发和重发，所以这里把「付了钱但还没发码」的订单列出来。
 *
 * 依据官方文档 https://guide.afdian.com/creator/developer
 *   签名：sign = md5(token + 'params' + params + 'ts' + ts + 'user_id' + user_id)
 *   接口：POST https://afdian.com/api/open/{ping,query-order,query-sponsor}
 *   入参：{"user_id": "...", "params": "{\"page\":1}", "ts": 1700000000, "sign": "..."}
 *   时间戳允许 3600 秒误差，超过返回 ec=400002
 *
 * 凭证从环境变量读，不写进文件、不进仓库：
 *   AFDIAN_USER_ID   开发者后台 https://afdian.com/dashboard/dev 里的 user_id
 *   AFDIAN_TOKEN     同一页生成的 API Token
 *
 * 用法：
 *   node tools/afdian.js ping
 *   node tools/afdian.js orders                最近一页（50 条）
 *   node tools/afdian.js orders --all          全部翻页
 *   node tools/afdian.js orders --since 2026-11-01 --csv licenses/orders.csv
 *   node tools/afdian.js pending               付了钱但台账里还没有记录的订单
 *   node tools/afdian.js mark 202611131829051234567890 --note "已发私信"
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SENT = path.join(ROOT, 'licenses', 'sent.tsv');   // 已发码台账，不入库
const API = 'afdian.com';

const USER_ID = process.env.AFDIAN_USER_ID || '';
const TOKEN = process.env.AFDIAN_TOKEN || '';

/* ---------- 签名与请求 ---------- */

function sign(paramsStr, ts) {
  // 官方示例：token 直接写值，其余按 key 字母序拼 k 与 v，中间没有任何连接符
  const kv = 'params' + paramsStr + 'ts' + ts + 'user_id' + USER_ID;
  return crypto.createHash('md5').update(TOKEN + kv).digest('hex');
}

function post(apiPath, params) {
  const paramsStr = JSON.stringify(params);
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    user_id: USER_ID,
    params: paramsStr,
    ts,
    sign: sign(paramsStr, ts)
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API,
      path: '/api/open/' + apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('返回不是 JSON：' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();
  });
}

const EC_HINT = {
  400001: '参数不全',
  400002: '时间戳过期（允许 3600 秒误差，检查本机时钟）',
  400003: 'params 不是合法 JSON 字符串',
  400004: '找不到有效 token（检查 AFDIAN_TOKEN）',
  400005: '签名校验失败（检查 AFDIAN_USER_ID 与 AFDIAN_TOKEN 是否同一账号）'
};

function check(env, what) {
  if (env.ec !== 200) {
    const hint = EC_HINT[env.ec] || env.em || '未知错误';
    throw new Error(what + ' 失败：ec=' + env.ec + '，' + hint);
  }
  return env.data;
}

/* ---------- 订单字段 ---------- */

// 订单号前 14 位是下单时间（YYYYMMDDHHmmss），比额外请求一次更省事
function orderTime(outTradeNo) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(outTradeNo || '');
  if (!m) return null;
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

const dayOf = (o) => (orderTime(o.out_trade_no) || '').slice(0, 10);

function fmtOrder(o) {
  return [
    orderTime(o.out_trade_no) || '(未知时间)',
    o.out_trade_no,
    ('¥' + (o.total_amount || '0.00')).padEnd(7),
    (o.status === 2 ? '已付款' : '状态' + o.status).padEnd(6),
    (o.remark || '').replace(/\s+/g, ' ').slice(0, 40)
  ].join('  ');
}

/* ---------- 已发码台账 ---------- */

function readSent() {
  if (!fs.existsSync(SENT)) return new Map();
  const map = new Map();
  const lines = fs.readFileSync(SENT, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [no, time, note] = line.split('\t');
    if (no) map.set(no.trim(), { time: time || '', note: note || '' });
  }
  return map;
}

function appendSent(no, note) {
  fs.mkdirSync(path.dirname(SENT), { recursive: true });
  if (!fs.existsSync(SENT)) {
    fs.writeFileSync(SENT, '# 订单号\t发码时间\t备注\n', 'utf8');
  }
  const time = new Date().toISOString().slice(0, 19).replace('T', ' ');
  fs.appendFileSync(SENT, [no, time, (note || '').replace(/\t/g, ' ')].join('\t') + '\n', 'utf8');
}

/* ---------- 命令 ---------- */

async function fetchPage(page, outTradeNo) {
  const params = outTradeNo ? { out_trade_no: outTradeNo } : { page: page || 1 };
  return check(await post('query-order', params), '查订单');
}

async function fetchAll(since) {
  const all = [];
  let page = 1;
  let totalPage = 1;
  do {
    const data = await fetchPage(page);
    totalPage = data.total_page || 1;
    for (const o of data.list || []) {
      if (since && dayOf(o) && dayOf(o) < since) return all;
      all.push(o);
    }
    page += 1;
  } while (page <= totalPage && page <= 60);   // 上限兜底，避免参数异常时打满
  return all;
}

function toCsv(orders, file) {
  const head = ['下单时间', '订单号', '金额', '状态', '留言', '方案ID'];
  const rows = orders.map((o) => [
    orderTime(o.out_trade_no) || '',
    o.out_trade_no,
    o.total_amount || '',
    o.status === 2 ? '已付款' : String(o.status),
    (o.remark || '').replace(/\s+/g, ' '),
    o.plan_id || ''
  ].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));

  const text = '\uFEFF' + [head.join(','), ...rows].join('\r\n') + '\r\n';
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  console.log('[写出] ' + file + '  共 ' + orders.length + ' 条');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  const opt = (name, fallback) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const has = (name) => argv.includes('--' + name);

  if (cmd === 'help' || has('help')) {
    const doc = fs.readFileSync(__filename, 'utf8').split('*/')[0]
      .replace(/^\/\*\*[ \t]*\r?\n/, '').replace(/^[ \t]*\*[ \t]?/gm, '');
    console.log(doc.trim());
    return;
  }

  if (!USER_ID || !TOKEN) {
    console.error('[缺少凭证] 请先设置环境变量 AFDIAN_USER_ID 与 AFDIAN_TOKEN');
    console.error('           在 https://afdian.com/dashboard/dev 页面可以找到这两个值');
    console.error('           PowerShell: $env:AFDIAN_USER_ID="..."; $env:AFDIAN_TOKEN="..."');
    process.exit(1);
  }

  if (cmd === 'ping') {
    const data = check(await post('ping', { a: 1 }), 'ping');
    console.log('[通过] 签名有效，账号 uid = ' + (data.uid || '(未返回)'));
    return;
  }

  if (cmd === 'orders') {
    const since = opt('since', '');
    const list = has('all') || since ? await fetchAll(since) : (await fetchPage(opt('page', 1))).list || [];
    if (!list.length) {
      console.log('[空] 没有订单');
      return;
    }
    console.log('下单时间            订单号                          金额     状态    留言');
    for (const o of list) console.log(fmtOrder(o));
    console.log('共 ' + list.length + ' 条');
    const csv = opt('csv', '');
    if (csv) toCsv(list, csv);
    return;
  }

  if (cmd === 'pending') {
    const since = opt('since', '');
    const list = has('all') || since ? await fetchAll(since) : (await fetchPage(1)).list || [];
    const sent = readSent();
    const pending = list.filter((o) => o.status === 2 && !sent.has(o.out_trade_no));
    if (!pending.length) {
      console.log('[清空] 范围内的已付款订单都已记录发码');
      return;
    }
    console.log('待发码 ' + pending.length + ' 笔：');
    for (const o of pending) console.log('  ' + fmtOrder(o));
    console.log('\n发完码后逐笔标记：node tools/afdian.js mark <订单号> --note "已发私信"');
    return;
  }

  if (cmd === 'mark') {
    const no = argv[1];
    if (!no || !/^\d{10,}$/.test(no)) {
      console.error('[参数错误] 需要一个订单号，形如 202611131829051234567890');
      process.exit(1);
    }
    const sent = readSent();
    if (sent.has(no)) {
      console.log('[已存在] 这单此前记过：' + sent.get(no).time + ' ' + sent.get(no).note);
      return;
    }
    appendSent(no, opt('note', ''));
    console.log('[记录] ' + no + ' 已写入 ' + path.relative(ROOT, SENT));
    return;
  }

  console.error('[未知命令] ' + cmd + '，可用：ping / orders / pending / mark / help');
  process.exit(1);
}

main().catch((err) => {
  console.error('[异常] ' + err.message);
  process.exit(1);
});
