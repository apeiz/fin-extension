/**
 * 界面逻辑测试（jsdom）
 *
 * e2e 覆盖不到扩展自身页面（Chrome 不允许导航到通过 CDP 安装的扩展页），
 * 所以选项页与弹窗的交互在这里验证：加载真实 HTML，挂上假的 chrome API，
 * 手动执行 shared.js / options.js / popup.js，模拟点击与输入。
 *
 * 运行：NODE_PATH=<workspace>/node_modules node test/ui.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// 依赖装在托管目录里，不设 NODE_PATH 也能跑
function loadDep(name) {
  try {
    return require(name);
  } catch (e) {
    const base =
      process.env.NODE_PATH ||
      path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
    return require(path.join(base, name));
  }
}

const { JSDOM } = loadDep('jsdom');

const SRC = path.join(__dirname, '..', 'src');

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('[通过] ' + name);
  } catch (err) {
    fail += 1;
    console.log('[失败] ' + name);
    console.log('       ' + err.message);
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 10));

/** 假的 chrome API：storage 异步回调，行为与真实 API 接近 */
function makeChromeMock(initial, options) {
  const opts = options || {};
  const store = initial ? JSON.parse(JSON.stringify(initial)) : {};
  const listeners = [];

  return {
    store,
    runtime: {
      lastError: null,
      openOptionsPage() {
        this.opened = true;
      },
      getURL(p) {
        return 'chrome-extension://test/' + p;
      }
    },
    tabs: {
      query(q, cb) {
        setTimeout(() => cb([{ url: opts.tabUrl || 'https://www.joinquant.com/' }]), 0);
      },
      create() {}
    },
    storage: {
      local: {
        get(key, cb) {
          setTimeout(() => {
            const res = {};
            if (Object.prototype.hasOwnProperty.call(store, key)) {
              res[key] = JSON.parse(JSON.stringify(store[key]));
            }
            cb(res);
          }, 0);
        },
        set(obj, cb) {
          setTimeout(() => {
            Object.keys(obj).forEach((k) => {
              store[k] = JSON.parse(JSON.stringify(obj[k]));
            });
            if (cb) cb();
            listeners.forEach((l) => l({ settings: { newValue: store.settings } }, 'local'));
          }, 0);
        }
      },
      onChanged: {
        addListener(fn) {
          listeners.push(fn);
        }
      }
    }
  };
}

/** 装载一个页面：解析真实 HTML，注入假 chrome，执行指定脚本 */
async function loadPage(htmlFile, scripts, chromeMock, beforeScript) {
  const html = fs.readFileSync(path.join(SRC, htmlFile), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test/src/' + htmlFile
  });

  dom.window.chrome = chromeMock;
  if (beforeScript) beforeScript(dom.window);

  for (const s of scripts) {
    const code = fs.readFileSync(path.join(SRC, s), 'utf8');
    dom.window.eval(code);
  }
  await tick(30);
  return dom;
}

// ---------------- 选项页 ----------------

async function testOptions() {
  console.log('--- 选项页 ---');

  await check('首次打开列出默认站点（与网页应用一致的三条）', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const hosts = Array.from(dom.window.document.querySelectorAll('.site-host')).map(
      (el) => el.textContent
    );
    assert(
      hosts.join('|') === '*.workbuddy.cn|*.163.com|*.csdn.net',
      '实际：' + JSON.stringify(hosts)
    );
  });

  await check('粘贴完整网址会被截成域名并写入存储', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    doc.getElementById('newHost').value = 'https://www.baidu.com/s?wd=1';
    doc.getElementById('addBtn').click();
    await tick(30);

    const hosts = Array.from(doc.querySelectorAll('.site-host')).map((el) => el.textContent);
    assert(
      hosts.join('|') === '*.workbuddy.cn|*.163.com|*.csdn.net|www.baidu.com',
      '列表：' + hosts.join('|')
    );
    assert(
      chromeMock.store.settings.sites.length === 4,
      '存储里只有 ' + chromeMock.store.settings.sites.length + ' 条'
    );
    assert(doc.getElementById('newHost').value === '', '输入框应被清空');
  });

  await check('添加重复域名不会产生第二条记录', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    // 默认已含 *.workbuddy.cn，大小写变体应被识别为同一条
    doc.getElementById('newHost').value = '*.WorkBuddy.CN';
    doc.getElementById('addBtn').click();
    await tick(30);

    assert(doc.querySelectorAll('.site-item').length === 3, '出现了重复条目');
  });

  await check('回车也能添加', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const input = doc.getElementById('newHost');
    input.value = 'example.com';
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(30);

    assert(chromeMock.store.settings.sites.some((s) => s.host === 'example.com'), '未写入存储');
  });

  await check('空输入不添加任何东西', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    doc.getElementById('newHost').value = '   ';
    doc.getElementById('addBtn').click();
    await tick(30);

    assert(doc.querySelectorAll('.site-item').length === 3, '列表条目数变了');
  });

  await check('站点开关写回存储并打上关闭样式', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const item = doc.querySelector('.site-item');
    const sw = item.querySelector('input[type="checkbox"]');
    sw.checked = false;
    sw.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(chromeMock.store.settings.sites[0].enabled === false, '存储未更新');
    assert(
      doc.querySelector('.site-item').className.indexOf('off') >= 0,
      '条目没有 off 样式'
    );
  });

  await check('删除按钮移除条目并写回存储', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    doc.querySelector('.site-item button.danger').click();
    await tick(30);

    assert(doc.querySelectorAll('.site-item').length === 2, '条目没被删掉');
    assert(chromeMock.store.settings.sites.length === 2, '存储没同步');
  });

  await check('「所有网站入夜」开关写回存储，并让站点开关失效', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const el = doc.getElementById('allSites');
    assert(el, '设置页缺少 allSites 开关');
    assert(el.checked === false, '默认应为关闭');

    el.checked = true;
    el.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(chromeMock.store.settings.allSites === true, '存储未更新');
    assert(
      doc.querySelector('.site-item input[type="checkbox"]').disabled === true,
      '打开后站点开关应失效（disabled）'
    );

    el.checked = false;
    el.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(chromeMock.store.settings.allSites === false, '关闭后存储未更新');
    assert(
      doc.querySelector('.site-item input[type="checkbox"]').disabled === false,
      '关掉后站点开关应恢复可用'
    );
  });

  await check('「保留原本深色区块」开关写回存储', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const el = doc.getElementById('keepDarkBlocks');
    assert(el, '设置页缺少 keepDarkBlocks 开关');
    assert(el.checked === true, '默认应为开启');
    el.checked = false;
    el.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(chromeMock.store.settings.keepDarkBlocks === false, '存储未更新');
  });

  await check('「图片/画布还原」开关写回存储', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const el = doc.getElementById('invertMedia');
    el.checked = false;
    el.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(chromeMock.store.settings.invertMedia === false, '存储未更新');
  });

  await check('自定义 CSS 停止输入 500ms 后才写入（防抖）', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    const ta = doc.getElementById('customCss');
    ta.value = '#side{opacity:.5}';
    ta.dispatchEvent(new dom.window.Event('input'));

    await tick(150);
    const midway = chromeMock.store.settings && chromeMock.store.settings.customCss;
    assert(!midway, '150ms 内就写入了，防抖没生效');

    await tick(600);
    assert(
      chromeMock.store.settings.customCss === '#side{opacity:.5}',
      '实际写入：' + chromeMock.store.settings.customCss
    );
  });

  await check('恢复默认设置把列表重置为通配规则', async () => {
    const chromeMock = makeChromeMock({
      settings: {
        enabled: false,
        sites: [{ host: 'a.com', enabled: true }],
        invertMedia: false,
        invertSvg: true,
        customCss: 'body{}'
      }
    });
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.querySelectorAll('.site-item').length === 1, '初始渲染异常');
    doc.getElementById('resetBtn').click();
    await tick(40);

    const hosts = Array.from(doc.querySelectorAll('.site-host')).map((el) => el.textContent);
    assert(
      hosts.join('|') === '*.workbuddy.cn|*.163.com|*.csdn.net',
      '重置后列表：' + hosts.join('|')
    );
    assert(chromeMock.store.settings.enabled === true, '总开关未重置');
    assert(chromeMock.store.settings.invertSvg === false, 'svg 开关未重置');
    assert(doc.getElementById('customCss').value === '', 'CSS 输入框未清空');
  });

  // ---------------- 配额与授权 ----------------

  const fillSites = (n) => {
    const list = [];
    for (let i = 0; i < n; i++) list.push({ host: 's' + i + '.com', enabled: true });
    return list;
  };

  await check('站点满 5 条时添加按钮禁用，配额显示 5/5', async () => {
    const chromeMock = makeChromeMock({ settings: { sites: fillSites(5), whitelist: [] } });
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    assert(
      doc.getElementById('siteQuota').textContent === '5/5',
      '配额显示：' + doc.getElementById('siteQuota').textContent
    );
    assert(doc.getElementById('addBtn').disabled === true, '添加按钮没禁用');
    assert(
      doc.getElementById('addBtn').textContent === '已达上限',
      '按钮文案：' + doc.getElementById('addBtn').textContent
    );
    assert(doc.getElementById('newHost').disabled === true, '输入框没禁用');
  });

  await check('超额的历史数据全部保留，只是禁止新增', async () => {
    const chromeMock = makeChromeMock({ settings: { sites: fillSites(8), whitelist: [] } });
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.querySelectorAll('.site-item').length === 8, '旧条目被裁掉了');

    doc.getElementById('newHost').value = 'another.com';
    doc.getElementById('addBtn').click();
    await tick(40);
    assert(chromeMock.store.settings.sites.length === 8, '超限状态还在新增');
  });

  await check('输入合法授权码后解锁，配额变成「不限」', async () => {
    const chromeMock = makeChromeMock({ settings: { sites: fillSites(5), whitelist: [] } });
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;
    const SD = dom.window.SiteDark;

    doc.getElementById('licInput').value = SD.licFormat(SD.licMake('TEST2026'));
    doc.getElementById('licBtn').click();
    await tick(60);

    assert(chromeMock.store.settings.license, '授权码没写入存储');
    assert(
      doc.getElementById('licBadge').textContent === '已解锁',
      '徽章：' + doc.getElementById('licBadge').textContent
    );
    assert(
      doc.getElementById('siteQuota').textContent === '5/不限',
      '配额：' + doc.getElementById('siteQuota').textContent
    );
    assert(doc.getElementById('addBtn').disabled === false, '解锁后添加按钮仍禁用');
    assert(doc.getElementById('licActive').hidden === false, '未展示已激活区块');
  });

  await check('非法授权码被拒绝，不写入存储', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    doc.getElementById('licInput').value = 'AAAA-AAAA-AAAA';
    doc.getElementById('licBtn').click();
    await tick(60);

    // 激活失败时不会触发 save，存储里可能根本没有 settings
    const saved = chromeMock.store.settings;
    assert(!saved || !saved.license, '非法码被写进存储');
    assert(doc.getElementById('licNotice').hidden === false, '没有给出错误提示');
    assert(doc.getElementById('licActive').hidden === true, '不该显示已激活');
  });

  await check('恢复默认设置不会清掉授权码', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;
    const SD = dom.window.SiteDark;

    doc.getElementById('licInput').value = SD.licMake('KEEP2026');
    doc.getElementById('licBtn').click();
    await tick(60);
    const before = chromeMock.store.settings.license.code;

    doc.getElementById('resetBtn').click();
    await tick(60);

    assert(chromeMock.store.settings.license, '重置把授权码清掉了');
    assert(chromeMock.store.settings.license.code === before, '授权码被改动');
    assert(chromeMock.store.settings.sites.length === 3, '站点没重置成默认三条');
  });
}

// ---------------- 弹窗 ----------------

async function testPopup() {
  console.log('');
  console.log('--- 工具栏弹窗 ---');

  await check('列表内的站点显示为已开启', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'https://www.workbuddy.cn/user/1' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.getElementById('currentHost').textContent === 'www.workbuddy.cn', '域名显示错误');
    assert(doc.getElementById('siteToggle').checked === true, '开关状态错误');
    assert(doc.getElementById('siteToggle').disabled === false, '开关不该被禁用');
  });

  await check('allSites 模式下弹窗开关变成白名单开关：关掉即加入白名单', async () => {
    const chromeMock = makeChromeMock(
      { settings: { enabled: true, allSites: true, sites: [], whitelist: [] } },
      { tabUrl: 'https://www.bilibili.com/' }
    );
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    const sw = doc.getElementById('siteToggle');
    assert(sw.checked === true, 'allSites 下应显示为已开启');
    assert(sw.disabled === false, 'allSites 下这个开关可用（用于控制白名单）');
    assert(
      doc.getElementById('hint').textContent.indexOf('所有网站入夜') >= 0,
      '提示语：' + doc.getElementById('hint').textContent
    );

    sw.checked = false;
    sw.dispatchEvent(new dom.window.Event('change'));
    await tick(40);

    assert(
      chromeMock.store.settings.whitelist.join('|') === 'www.bilibili.com',
      '白名单：' + JSON.stringify(chromeMock.store.settings.whitelist)
    );
  });

  await check('白名单里的站点在 allSites 下显示为未开启', async () => {
    const chromeMock = makeChromeMock(
      { settings: { enabled: true, allSites: true, sites: [], whitelist: ['*.bilibili.com'] } },
      { tabUrl: 'https://www.bilibili.com/' }
    );
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.getElementById('siteToggle').checked === false, '应显示为未开启');
    assert(
      doc.getElementById('hint').textContent.indexOf('白名单') >= 0,
      '提示语：' + doc.getElementById('hint').textContent
    );
  });

  await check('设置页白名单区块随 allSites 开关显示与隐藏', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.getElementById('whitelistBlock').hidden === true, '默认应隐藏');
    assert(doc.getElementById('allSites').checked === false, 'allSites 默认关闭');

    const sw = doc.getElementById('allSites');
    sw.checked = true;
    sw.dispatchEvent(new dom.window.Event('change'));
    await tick(30);

    assert(doc.getElementById('whitelistBlock').hidden === false, '打开后应显示');
    assert(
      doc.getElementById('saveState').classList.contains('show'),
      '改动应写回存储'
    );
  });

  await check('设置页白名单：添加与移除都写回存储', async () => {
    const chromeMock = makeChromeMock({
      settings: { enabled: true, allSites: true, sites: [] }
    });
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    doc.getElementById('newWhitelist').value = 'www.bilibili.com';
    doc.getElementById('addWhitelistBtn').click();
    await tick(30);

    assert(
      chromeMock.store.settings.whitelist.join('|') === 'www.bilibili.com',
      '实际：' + JSON.stringify(chromeMock.store.settings.whitelist)
    );
    assert(doc.querySelectorAll('#whitelistList .site-item').length === 1, '白名单未渲染');

    doc.querySelector('#whitelistList button.danger').click();
    await tick(30);
    assert(chromeMock.store.settings.whitelist.length === 0, '移除后存储未同步');
  });

  await check('添加已被通配规则覆盖的域名时只提示、不重复添加', async () => {
    const chromeMock = makeChromeMock(null);
    const dom = await loadPage('options.html', ['shared.js', 'options.js'], chromeMock);
    const doc = dom.window.document;

    // 默认列表已含 *.163.com，再输入裸域 163.com 不该产生第二条
    doc.getElementById('newHost').value = '163.com';
    doc.getElementById('addBtn').click();
    await tick(30);

    const hosts = Array.from(doc.querySelectorAll('#siteList .site-host')).map((el) => el.textContent);
    assert(hosts.indexOf('163.com') < 0, '不该新增裸域条目：' + hosts.join('|'));
    assert(hosts.filter((h) => h.indexOf('163.com') >= 0).length === 1, '163 相关条目只该有一条');
    assert(doc.getElementById('addNotice').hidden === false, '应给出覆盖提示');
  });

  await check('列表外的站点显示为未开启，并给出说明', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'https://www.baidu.com/' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.getElementById('siteToggle').checked === false, '开关状态错误');
    assert(
      doc.getElementById('hint').textContent.indexOf('不在列表') >= 0,
      '提示语：' + doc.getElementById('hint').textContent
    );
  });

  await check('在弹窗里关掉当前站点会写回存储', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'https://www.joinquant.com/' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    const sw = doc.getElementById('siteToggle');
    sw.checked = false;
    sw.dispatchEvent(new dom.window.Event('change'));
    await tick(40);

    // 默认是 *.joinquant.com 通配，关掉当前站点会生成一条精确的关闭条目，
    // 精确条目优先于通配，所以最终解析结果必须是关闭
    const sites = chromeMock.store.settings.sites;
    const exact = sites.filter((s) => s.host === 'www.joinquant.com');
    assert(exact.length === 1 && exact[0].enabled === false, '未生成精确的关闭条目：' + JSON.stringify(sites));
    assert(
      dom.window.SiteDark.resolveHost(chromeMock.store.settings, 'www.joinquant.com').enabled === false,
      '解析结果仍为启用'
    );
  });

  await check('把列表外的站点打开会新增一条记录', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'https://www.baidu.com/' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    const sw = doc.getElementById('siteToggle');
    sw.checked = true;
    sw.dispatchEvent(new dom.window.Event('change'));
    await tick(40);

    const sites = chromeMock.store.settings.sites;
    assert(sites.length === 4, '条目数 ' + sites.length);
    assert(
      sites[3].host === 'www.baidu.com' && sites[3].enabled === true,
      '新条目：' + JSON.stringify(sites[3])
    );
  });

  await check('非网页标签页（chrome://）不显示域名，开关禁用', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'chrome://settings/' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    assert(doc.getElementById('siteToggle').disabled === true, '开关应被禁用');
    assert(
      doc.getElementById('currentHost').textContent.indexOf('不适用') >= 0,
      '提示：' + doc.getElementById('currentHost').textContent
    );
  });

  await check('总开关切换写入存储', async () => {
    const chromeMock = makeChromeMock(null, { tabUrl: 'https://www.joinquant.com/' });
    const dom = await loadPage('popup.html', ['shared.js', 'popup.js'], chromeMock);
    const doc = dom.window.document;

    const g = doc.getElementById('globalToggle');
    g.checked = false;
    g.dispatchEvent(new dom.window.Event('change'));
    await tick(40);

    assert(chromeMock.store.settings.enabled === false, '存储未更新');
    assert(
      doc.getElementById('hint').textContent.indexOf('总开关已关闭') >= 0,
      '提示：' + doc.getElementById('hint').textContent
    );
  });
}

(async () => {
  await testOptions();
  await testPopup();
  console.log('');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})();
