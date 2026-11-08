/**
 * shared.js 逻辑回归测试
 * 用 node test/shared.test.js 运行。只测纯逻辑，不碰 DOM。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'src', 'shared.js');
const code = fs.readFileSync(SRC, 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: SRC });

const SD = sandbox.window.SiteDark;

let pass = 0;
let fail = 0;

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

// ---------- normalizeHost ----------

check('normalizeHost: 完整网址截成域名', () => {
  assert.strictEqual(
    SD.normalizeHost('https://www.joinquant.com/user/123?tab=1#top'),
    'www.joinquant.com'
  );
});

check('normalizeHost: 大小写与端口归一', () => {
  assert.strictEqual(SD.normalizeHost('  WWW.JoinQuant.COM:8080  '), 'www.joinquant.com');
});

check('normalizeHost: 空输入返回空串', () => {
  assert.strictEqual(SD.normalizeHost(''), '');
  assert.strictEqual(SD.normalizeHost(null), '');
  assert.strictEqual(SD.normalizeHost(undefined), '');
  assert.strictEqual(SD.normalizeHost('   '), '');
});

check('normalizeHost: 保留通配前缀', () => {
  assert.strictEqual(SD.normalizeHost('*.joinquant.com'), '*.joinquant.com');
  assert.strictEqual(SD.normalizeHost('*.JoinQuant.com/x'), '*.joinquant.com');
});

check('normalizeHost: 单独的通配符不会被当成合法规则', () => {
  assert.strictEqual(SD.normalizeHost('*.'), '');
});

// ---------- hostMatch ----------

check('hostMatch: 精确域名只匹配自身', () => {
  assert.strictEqual(SD.hostMatch('www.joinquant.com', 'www.joinquant.com'), true);
  assert.strictEqual(SD.hostMatch('joinquant.com', 'www.joinquant.com'), false);
  assert.strictEqual(SD.hostMatch('a.www.joinquant.com', 'www.joinquant.com'), false);
});

check('hostMatch: 通配规则覆盖裸域与所有子域', () => {
  assert.strictEqual(SD.hostMatch('joinquant.com', '*.joinquant.com'), true);
  assert.strictEqual(SD.hostMatch('www.joinquant.com', '*.joinquant.com'), true);
  assert.strictEqual(SD.hostMatch('a.b.joinquant.com', '*.joinquant.com'), true);
});

check('hostMatch: 通配规则不会误伤相似后缀', () => {
  assert.strictEqual(SD.hostMatch('eviljoinquant.com', '*.joinquant.com'), false);
  assert.strictEqual(SD.hostMatch('joinquant.com.cn', '*.joinquant.com'), false);
});

// ---------- 默认配置 ----------

check('默认配置: 与网页应用一致的三个站点（含子域）', () => {
  const s = SD.normalizeSettings(undefined);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.sites.length, 3);
  assert.strictEqual(s.sites[0].host, '*.workbuddy.cn');
  assert.strictEqual(s.sites[1].host, '*.163.com');
  assert.strictEqual(s.sites[2].host, '*.csdn.net');
  assert.strictEqual(SD.isEnabledFor(s, 'www.workbuddy.cn'), true);
  assert.strictEqual(SD.isEnabledFor(s, 'www.163.com'), true);
  assert.strictEqual(SD.isEnabledFor(s, 'news.csdn.net'), true, '子域也要覆盖');
  assert.strictEqual(SD.isEnabledFor(s, 'www.baidu.com'), false);
});

check('旧的聚宽单条默认会迁移成三条新默认', () => {
  const legacy = {
    enabled: true,
    sites: [{ host: '*.joinquant.com', enabled: true }],
    invertMedia: true,
    invertSvg: false,
    keepDarkBlocks: true,
    customCss: ''
  };
  const s = SD.normalizeSettings(legacy);
  assert.strictEqual(s.sites.length, 3);
  assert.strictEqual(s.sites[0].host, '*.workbuddy.cn');
});

check('用户自己维护的列表不会被迁移改写', () => {
  const mine = {
    enabled: true,
    sites: [{ host: 'www.joinquant.com', enabled: false }],
    invertMedia: true,
    invertSvg: false,
    keepDarkBlocks: true,
    customCss: ''
  };
  const s = SD.normalizeSettings(mine);
  assert.strictEqual(s.sites.length, 1);
  assert.strictEqual(s.sites[0].host, 'www.joinquant.com');
  assert.strictEqual(s.sites[0].enabled, false);
});

check('默认配置: 总开关关闭时任何站点都不生效', () => {
  const s = SD.normalizeSettings(undefined);
  s.enabled = false;
  assert.strictEqual(SD.isEnabledFor(s, 'www.joinquant.com'), false);
});

check('空列表被保留，不会偷偷回填默认站点', () => {
  const s = SD.normalizeSettings({ enabled: true, sites: [] });
  assert.strictEqual(s.sites.length, 0);
  assert.strictEqual(SD.isEnabledFor(s, 'www.joinquant.com'), false);
});

// ---------- 所有网站入夜 ----------

check('allSites 默认关闭', () => {
  const s = SD.normalizeSettings(undefined);
  assert.strictEqual(s.allSites, false);
  assert.strictEqual(SD.defaultSettings().allSites, false);
});

check('allSites 打开时任何站点都生效，站点列表开关不参与', () => {
  const s = SD.normalizeSettings({
    enabled: true,
    allSites: true,
    sites: [{ host: 'www.joinquant.com', enabled: false }]
  });
  assert.strictEqual(SD.isEnabledFor(s, 'www.joinquant.com'), true, '列表里关掉的站点也要生效');
  assert.strictEqual(SD.isEnabledFor(s, 'www.baidu.com'), true);
  assert.strictEqual(SD.isEnabledFor(s, 'www.163.com'), true);
  const r = SD.resolveHost(s, 'www.baidu.com');
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.source, 'all', '来源应标记为 all 供弹窗显示专用文案');
});

check('allSites 打开但总开关关闭时仍然不生效', () => {
  const s = SD.normalizeSettings({ enabled: false, allSites: true, sites: [] });
  assert.strictEqual(SD.isEnabledFor(s, 'www.baidu.com'), false);
});

check('脏数据被清理: 去重、去空、去非法项', () => {
  const s = SD.normalizeSettings({
    sites: [
      { host: 'a.com', enabled: false },
      'https://A.com/x', // 与上一条重复：保留先出现的关闭状态
      { host: '' },
      null,
      42,
      '*.b.com'
    ]
  });
  // 沙箱里创建的数组与主 realm 的 Array.prototype 不同，deepStrictEqual 会误判，转成字符串比较
  assert.strictEqual(
    s.sites.map((x) => x.host).join('|'),
    'a.com|*.b.com'
  );
  assert.strictEqual(s.sites[0].enabled, false, '重复条目应保留首次出现的状态');
  assert.strictEqual(s.sites[1].enabled, true, '字符串条目默认视为启用');
});

check('非对象的 sites 才回退默认', () => {
  const s = SD.normalizeSettings({ sites: 'oops' });
  assert.strictEqual(s.sites.length, 3);
  assert.strictEqual(s.sites[0].host, '*.workbuddy.cn');
});

// ---------- 精确优先于通配 ----------

check('精确条目优先: 通配开启时单独关掉某子域', () => {
  const s = SD.normalizeSettings({
    sites: [
      { host: '*.joinquant.com', enabled: true },
      { host: 'www.joinquant.com', enabled: false }
    ]
  });
  const r = SD.resolveHost(s, 'www.joinquant.com');
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.source, 'exact');
  assert.strictEqual(SD.isEnabledFor(s, 'bbs.joinquant.com'), true);
});

check('精确条目优先: 精确条目为空域名时不误判', () => {
  const s = SD.normalizeSettings({
    sites: [{ host: 'a.com', enabled: true }]
  });
  assert.strictEqual(SD.resolveHost(s, '').enabled, false);
});

// ---------- CSS 生成 ----------

check('CSS: 根元素反色 + 背景压白', () => {
  const css = SD.fullCss(SD.normalizeSettings(undefined));
  assert.ok(
    /html\{background-color:#fff !important;filter:invert\(0\.92\) hue-rotate\(180deg\) !important;\}/.test(css),
    '根元素规则不对：' + css.split('\n')[0]
  );
});

check('CSS: 位图与画布二次反转（K 线红绿不颠倒）', () => {
  const css = SD.fullCss(SD.normalizeSettings(undefined));
  assert.ok(/canvas/.test(css));
  assert.ok(/img/.test(css));
  assert.ok(/iframe/.test(css));
  assert.ok(!/^svg\{/m.test(css), '默认不对 svg 整体反转');
});

check('CSS: 关闭媒体还原时不再出现媒体二次反转规则', () => {
  const s = SD.normalizeSettings({ invertMedia: false, sites: [{ host: 'a.com', enabled: true }] });
  const css = SD.fullCss(s);
  // 深色区块那条规则里也会提到 canvas，所以只检查全局媒体选择器本身
  assert.ok(!/^img,video,canvas,picture/m.test(css), '仍有全局媒体反转规则');
});

check('CSS: 开启 svg 还原时追加 svg 规则', () => {
  const s = SD.normalizeSettings({ invertSvg: true, sites: [{ host: 'a.com', enabled: true }] });
  assert.ok(/\nsvg\{/.test(SD.fullCss(s)));
});

check('CSS: 自定义 CSS 追加在末尾，空串不追加', () => {
  const withCss = SD.normalizeSettings({
    customCss: '#side{opacity:.9 !important}',
    sites: [{ host: 'a.com', enabled: true }]
  });
  const css = SD.fullCss(withCss);
  assert.ok(css.trim().endsWith('#side{opacity:.9 !important}'));

  const noCss = SD.normalizeSettings({ customCss: '   ', sites: [{ host: 'a.com', enabled: true }] });
  assert.ok(!/用户自定义修正/.test(SD.fullCss(noCss)));
});

check('CSS: 默认包含深色区块恢复规则，并清掉区块内媒体的二次反转', () => {
  const css = SD.fullCss(SD.normalizeSettings(undefined));
  assert.ok(/\[data-sd-dark-block\]\{filter:invert\(0\.92\)/.test(css), '缺少深色区块反转规则');
  assert.ok(
    /\[data-sd-dark-block\] img/.test(css) && /\[data-sd-dark-block\] canvas/.test(css),
    '缺少区块内媒体取消反转的规则'
  );
  assert.ok(/filter:none !important/.test(css), '取消反转没有用 !important');
});

check('CSS: 关掉深色区块识别后不再生成相关规则', () => {
  const s = SD.normalizeSettings({ keepDarkBlocks: false, sites: [{ host: 'a.com', enabled: true }] });
  const css = SD.fullCss(s);
  assert.ok(css.indexOf('data-sd-dark-block') < 0, '仍包含深色区块规则');
});

check('默认配置：所有网站入夜关闭、白名单为空', () => {
  const s = SD.normalizeSettings(undefined);
  assert.strictEqual(s.allSites, false, 'allSites 默认应为 false');
  assert.strictEqual(s.whitelist.length, 0);
});

check('白名单：allSites 打开时，命中白名单的站点不生效', () => {
  const s = SD.normalizeSettings({ allSites: true, sites: [], whitelist: ['www.bilibili.com'] });
  assert.strictEqual(SD.isEnabledFor(s, 'www.bilibili.com'), false);
  assert.strictEqual(SD.isEnabledFor(s, 'www.baidu.com'), true);
});

check('白名单：支持通配子域，且不误伤相似域名', () => {
  const s = SD.normalizeSettings({ allSites: true, sites: [], whitelist: ['*.bilibili.com'] });
  assert.strictEqual(SD.isEnabledFor(s, 'www.bilibili.com'), false);
  assert.strictEqual(SD.isEnabledFor(s, 'bilibili.com'), false);
  assert.strictEqual(SD.isEnabledFor(s, 'live.bilibili.com'), false);
  assert.strictEqual(SD.isEnabledFor(s, 'www.bilibili.co'), true);
});

check('白名单：allSites 关闭时不参与判断', () => {
  const s = SD.normalizeSettings({
    allSites: false,
    sites: [{ host: 'www.bilibili.com', enabled: true }],
    whitelist: ['www.bilibili.com']
  });
  assert.strictEqual(
    SD.isEnabledFor(s, 'www.bilibili.com'),
    true,
    '白名单只服务于「所有网站入夜」，关掉后不该影响指定列表'
  );
});

check('白名单：总开关关闭时一律不生效', () => {
  const s = SD.normalizeSettings({ enabled: false, allSites: true, sites: [], whitelist: [] });
  assert.strictEqual(SD.isEnabledFor(s, 'www.baidu.com'), false);
});

check('白名单被规范化：去重、去空、去非法项', () => {
  const s = SD.normalizeSettings({
    whitelist: ['https://WWW.Bilibili.com/x', '', null, 42, '*.bilibili.com', 'www.bilibili.com']
  });
  assert.strictEqual(s.whitelist.join('|'), 'www.bilibili.com|*.bilibili.com');
});

check('覆盖检查：通配覆盖裸域，反方向不算覆盖', () => {
  const s = SD.normalizeSettings({ sites: [{ host: '*.163.com', enabled: true }] });
  assert.strictEqual(SD.coveringRule(s, '163.com'), '*.163.com', '裸域应被通配覆盖');
  assert.strictEqual(SD.coveringRule(s, 'news.163.com'), '*.163.com');
  assert.strictEqual(SD.coveringRule(s, 'www.qq.com'), '');

  const t = SD.normalizeSettings({ sites: [{ host: '163.com', enabled: true }] });
  assert.strictEqual(SD.coveringRule(t, '*.163.com'), '', '通配范围更大，不算被覆盖');
});

// ---------- 授权码与额度 ----------

check('生成 12 位授权码，校验通过', () => {
  const code = SD.licMake('YUE7K3M9');
  assert.strictEqual(code.length, 12);
  assert.strictEqual(SD.licValid(code), true);
});

check('授权码改动任意一位都校验失败', () => {
  const code = SD.licMake('YUE7K3M9');
  for (let i = 0; i < 12; i++) {
    const alt = code[i] === 'A' ? 'B' : 'A';
    const bad = code.slice(0, i) + alt + code.slice(i + 1);
    assert.strictEqual(SD.licValid(bad), false, '第 ' + i + ' 位被改动却没发现');
  }
});

check('带分隔符、小写、空格都能识别', () => {
  const code = SD.licMake('PQ4TYUE7');
  assert.strictEqual(SD.licValid(SD.licFormat(code)), true);
  const messy = ' ' + code.toLowerCase().slice(0, 4) + '-' + code.toLowerCase().slice(4, 8) +
    ' ' + code.slice(8).toLowerCase() + ' ';
  assert.strictEqual(SD.licValid(messy), true, '归一化没兜住大小写与分隔符');
});

check('长度不对、乱输、空值一律失败', () => {
  assert.strictEqual(SD.licValid(''), false);
  assert.strictEqual(SD.licValid(null), false);
  assert.strictEqual(SD.licValid('YUE7K3M9'), false, '11 位却被放行');
  assert.strictEqual(SD.licValid('HELLOWORLD12'), false);
});

check('免费额度为站点 5 条、白名单 3 条', () => {
  const lim = SD.limitsFor({ license: null });
  assert.strictEqual(lim.sites, 5);
  assert.strictEqual(lim.whitelist, 3);
});

check('激活后站点与白名单都不再限制', () => {
  const lim = SD.limitsFor({ license: { code: SD.licMake('ABCD2345'), at: 1 } });
  assert.strictEqual(lim.sites, Infinity);
  assert.strictEqual(lim.whitelist, Infinity);
});

check('合法授权码随配置持久化，分隔符被去掉', () => {
  const code = SD.licMake('ZZZZ9999');
  const s = SD.normalizeSettings({ sites: [], license: { code: SD.licFormat(code), at: 123 } });
  assert.ok(s.license, '合法码被丢弃');
  assert.strictEqual(s.license.code, code);
  assert.strictEqual(s.license.at, 123);
});

check('伪造的授权码在归一化时被丢掉', () => {
  const s = SD.normalizeSettings({ sites: [], license: { code: 'AAAA-AAAA-AAAA', at: 1 } });
  assert.strictEqual(s.license, null);
});

check('license 字段被改成字符串也不会崩', () => {
  assert.strictEqual(SD.normalizeSettings({ sites: [], license: 'yes' }).license, null);
  assert.strictEqual(SD.normalizeSettings({ sites: [], license: 1 }).license, null);
});

check('已有条目超过免费额度时原样保留，绝不裁剪', () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push({ host: 'site' + i + '.com', enabled: true });
  const s = SD.normalizeSettings({ sites: many });
  assert.strictEqual(s.sites.length, 8, '旧用户的条目被额度裁掉了');
});

check('授权码字母表是 32 个互不相同的字符', () => {
  // 这条不是形式检查：licEncode 用 % 32 取位，表长为 31 会在边界产出空串，
  // 码会静默少一位，只有在批量生成时才暴露出来。
  assert.strictEqual(SD.LIC_ALPHA.length, 32, '实际长度 ' + SD.LIC_ALPHA.length);
  assert.strictEqual(new Set(SD.LIC_ALPHA).size, 32, '有重复字符');
});

check('批量生成 400 个码，长度与校验全部正确且不重复', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const code = SD.licMake(String(i).padStart(8, 'A'));
    assert.strictEqual(code.length, 12, '第 ' + i + ' 个长度为 ' + code.length + '：' + code);
    assert.strictEqual(SD.licValid(code), true, '第 ' + i + ' 个校验失败：' + code);
    assert.strictEqual(seen.has(code), false, '第 ' + i + ' 个重复：' + code);
    seen.add(code);
  }
});

// ---------- 汇总 ----------

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
