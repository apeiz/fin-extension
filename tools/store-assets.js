/**
 * 商店素材生成（Edge Add-ons）
 *
 * 产出到 store/：
 *   01-site.png            1280x800  真实站点入夜后整屏
 *   02-compare-sspai       1280x800  左右对比
 *   03-compare-163         1280x800  图文站对比，展示图片保色
 *   04-popup.png           1280x800  弹窗叠加在站点上
 *   05-options.png         1280x800  设置页：站点列表
 *   06-options-all.png     1280x800  设置页：全部入夜 + 白名单
 *   promo-small.png         440x280  小宣传图（不传会导致商店搜索不出结果）
 *                                    纯色构图，不用底图，见 htmlPromoSmall
 *   promo-large.png        1400x560  大宣传图
 *
 * 图标另由 tools/make_icons.py 生成：
 *   python tools/make_icons.py --size 300 --out store/logo-300.png
 *
 * 只重生成其中几张时，在命令后面写名字：
 *   node tools/store-assets.js promo-small
 *
 * 底图用预置的三组 1280x800 截图，比现场抓取稳定，也不受网络影响。
 * 扩展自身页面在自动化环境里无法直接导航，这里用 file:// 打开真实 HTML 并注入
 * 假的 chrome API，让界面显示出真实内容后再合成。
 *
 * 运行：node tools/store-assets.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 依赖装在托管目录里，不设 NODE_PATH 也能跑
function loadDep(name) {
  try {
    return require(name);
  } catch (e) {
    // 扩展本身零依赖，截图工具借用已装的 node_modules
    const bases = [
      process.env.NODE_PATH,
      path.resolve(__dirname, '..', '..', 'fall-in-night', 'node_modules'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
      '/usr/local/lib/node_modules',
      '/usr/lib/node_modules'
    ].filter(Boolean);
    for (const base of bases) {
      try {
        return require(path.join(base, name));
      } catch (err) {
        // 换下一个
      }
    }
    throw new Error('找不到依赖 ' + name + '，请先 npm i -g ' + name + ' 或设置 NODE_PATH');
  }
}

const puppeteer = loadDep('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
// 底图：优先用仓库自带素材，没有就退回同级抓图工具的产出目录
const SHOT_DIRS = [
  path.resolve(ROOT, 'test', 'fixtures', 'shots'),
  path.resolve(ROOT, '..', 'fall-in-night', 'public', 'shots')
];
const SHOTS = SHOT_DIRS.find((d) => fs.existsSync(d)) || SHOT_DIRS[0];
const OUT = path.join(ROOT, 'store');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const C = {
  bg: '#0d1017',
  bg2: '#16181d',
  gold: '#ffc45c',
  text: '#f2f4f8',
  muted: '#9aa2b3'
};

// 三组 1280x800 底图的缓存键
const SHOT_HOSTS = {
  devpress: '54d96db3b6377612',
  sspai: 'd3c494c6403e298f',
  netease: '3742deedb74d417c'
};

function fileUri(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'webp' ? 'image/webp' : 'image/png';
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

const bufUri = (buf) => 'data:image/png;base64,' + buf.toString('base64');
const shot = (key, side) => path.join(SHOTS, SHOT_HOSTS[key] + '-' + side + '.webp');

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { overflow: hidden; }
  body {
    background: ${C.bg};
    color: ${C.text};
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .abs { position: absolute; }
  .pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px; border-radius: 999px;
    background: rgba(13,16,23,.82); color: ${C.text};
    font-size: 15px; letter-spacing: .01em;
    border: 1px solid rgba(255,196,92,.28);
    backdrop-filter: blur(8px);
  }
  .pill i { width: 7px; height: 7px; border-radius: 50%; background: ${C.gold}; }
`;

const page = (body, extra) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extra || ''}</style></head>` +
  `<body>${body}</body></html>`;

/* ---------- 扩展界面：注入假 chrome API 后截图 ---------- */

function mockApi(host, allSites) {
  return `
(function () {
  var settings = {
    enabled: true,
    allSites: ${allSites ? 'true' : 'false'},
    sites: [
      { host: '*.163.com', enabled: true },
      { host: '*.csdn.net', enabled: true },
      { host: '*.sspai.com', enabled: true }
    ],
    whitelist: ${allSites ? "['*.bilibili.com', 'www.youtube.com']" : '[]'},
    invertMedia: true,
    invertSvg: false,
    keepDarkBlocks: true,
    customCss: ''
  };
  window.chrome = {
    runtime: {
      lastError: null,
      openOptionsPage: function () {},
      getURL: function (p) { return p; }
    },
    tabs: {
      query: function (q, cb) {
        setTimeout(function () { cb([{ url: 'https://${host}/' }]); }, 0);
      },
      create: function () {}
    },
    storage: {
      local: {
        get: function (k, cb) {
          var r = {}; r[k] = JSON.parse(JSON.stringify(settings));
          setTimeout(function () { cb(r); }, 0);
        },
        set: function (o, cb) { if (o.settings) settings = o.settings; if (cb) setTimeout(cb, 0); }
      },
      onChanged: { addListener: function () {} }
    }
  };
})();
`;
}

const fileUrl = (name) => 'file:///' + path.join(ROOT, 'src', name).replace(/\\/g, '/');

async function renderUI(browser, opts) {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(mockApi(opts.host, opts.allSites));
  await p.setViewport({
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: opts.dsf || 1
  });
  await p.goto(fileUrl(opts.page), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 420));
  const buf = await p.screenshot({ fullPage: !!opts.fullPage });
  await p.close();
  return buf;
}

/* ---------- 01 整屏效果 ---------- */
const htmlSite = () => page(`
  <img class="abs" src="${fileUri(shot('devpress', 'after'))}"
       style="inset:0;width:1280px;height:800px">
  <div class="abs pill" style="right:36px;bottom:32px">
    <i></i>入夜后 · devpress.csdn.net
  </div>
`);

/* ---------- 02/03 左右对比 ---------- */
function htmlCompare(key, title, note, label) {
  return page(`
    <div class="abs" style="left:60px;top:118px">
      <div style="font-size:30px;font-weight:700;letter-spacing:-.01em">${title}</div>
      <div style="margin-top:9px;font-size:16px;color:${C.muted}">${note}</div>
    </div>
    <div class="abs" style="left:60px;top:238px;width:1160px">
      <div style="display:flex;border-radius:14px;overflow:hidden;
                  box-shadow:0 22px 60px rgba(0,0,0,.55);background:${C.bg2}">
        <img src="${fileUri(shot(key, 'before'))}" style="width:578px;height:361px;object-fit:cover;display:block">
        <div style="width:4px;background:${C.gold};flex:0 0 4px"></div>
        <img src="${fileUri(shot(key, 'after'))}" style="width:578px;height:361px;object-fit:cover;display:block">
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:14px;
                  font-size:15px;color:${C.muted};letter-spacing:.04em">
        <span>原样</span><span>入夜</span>
      </div>
    </div>
    <div class="abs pill" style="left:60px;bottom:72px"><i></i>${label}</div>
  `);
}

/* ---------- 04 弹窗 ---------- */
const htmlPopup = (popupUri) => page(`
    <img class="abs" src="${fileUri(shot('netease', 'after'))}"
         style="inset:0;width:1280px;height:800px">
    <div class="abs" style="inset:0;background:linear-gradient(90deg,
      rgba(13,16,23,.975) 0%, rgba(13,16,23,.96) 30%, rgba(13,16,23,.86) 48%,
      rgba(13,16,23,.50) 68%, rgba(13,16,23,.20) 100%)"></div>

    <div class="abs" style="left:92px;top:262px;width:452px">
      <div style="font-size:34px;font-weight:700;line-height:1.42;letter-spacing:-.01em">
        点一下<br>这个站就入夜了
      </div>
      <div style="margin-top:20px;font-size:17px;line-height:1.85;color:${C.muted}">
        工具栏图标里切换当前站点。<br>改动立即作用于已打开的页面，不用刷新。
      </div>
    </div>

    <div class="abs" style="left:620px;top:206px;width:412px;
         border-radius:16px;overflow:hidden;
         box-shadow:0 34px 80px rgba(0,0,0,.66), 0 0 0 1px rgba(255,255,255,.09)">
      <img src="${bufUri(popupUri)}" style="width:412px;display:block">
    </div>
  `);

/* ---------- 05/06 设置页 ---------- */
function htmlOptions(uri, title, bullets) {
  const list = bullets.map((b) => `
    <div style="display:flex;gap:11px;margin-top:20px;font-size:16px;line-height:1.6;color:${C.muted}">
      <span style="color:${C.gold};flex:0 0 auto">—</span><span>${b}</span>
    </div>`).join('');
  return page(`
    <div class="abs" style="left:64px;top:44px;width:900px;height:700px;border-radius:16px;overflow:hidden;
         box-shadow:0 26px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)">
      <img src="${bufUri(uri)}" style="width:900px;display:block">
    </div>
    <div class="abs" style="left:64px;top:546px;width:900px;height:198px;border-radius:0 0 16px 16px;
         background:linear-gradient(to bottom, rgba(13,16,23,0) 0%, ${C.bg} 92%)"></div>
    <div class="abs" style="left:1004px;top:120px;width:236px">
      <div style="font-size:27px;font-weight:700;line-height:1.45">${title}</div>
      ${list}
    </div>
  `);
}

/* ---------- 小宣传图 ----------
 * 440x280 在商店列表里只有两百来像素宽，塞网页截图内容是看不清的，
 * 于是只用三个元素说清一件事：左边原样、右边入夜、中间一道金线。
 * 左右都是纯色，不依赖任何截图，缩放后也不糊。
 *
 * 那圈细线必须左右各配一次色：品牌金 #ffc45c 压在暖白上实测对比只有 1.49，
 * 等于看不见；深一档的 #b8791c 才够。所以画两个同样的框，各自裁掉一半。
 */
const htmlPromoSmall = () => {
  const W = 440;
  const H = 280;
  const LINE = 3;                        // 金线宽度，缩到一半仍有 1.4px
  const MID = W / 2;
  const HALF = (W - LINE) / 2;
  const BOX = 128;                       // 细线方框外沿
  const ICON = 100;                      // 图标显示尺寸
  const GAP = (BOX - ICON) / 2;          // 框与图标之间的留白
  const RING = 2;                        // 细线宽度
  const RADIUS = Math.round(ICON * 0.22);
  const LEFT = MID - BOX / 2;
  const TOP = (H - BOX) / 2;

  const ring = (color, left) => `
    <div style="position:absolute;left:${left}px;top:${TOP}px;
         width:${BOX}px;height:${BOX}px;
         border:${RING}px solid ${color};
         border-radius:${RADIUS + GAP}px"></div>`;

  return page(`
    <div class="abs" style="left:0;top:0;width:${HALF}px;height:${H}px;background:#f4f1e8"></div>
    <div class="abs" style="left:${MID + LINE / 2}px;top:0;width:${HALF}px;height:${H}px;background:#10131a"></div>

    <div class="abs" style="left:${MID - LINE / 2}px;top:0;width:${LINE}px;height:${H}px;
         background:${C.gold}"></div>

    <!-- 左半圈用深金、右半圈用品牌金，各裁一半；框的圆角 = 图标圆角 + 留白，
         两者同心，看上去才是一圈等距的线 -->
    <div class="abs" style="left:0;top:0;width:${MID}px;height:${H}px;overflow:hidden">
      ${ring('#b8791c', LEFT)}
    </div>
    <div class="abs" style="left:${MID}px;top:0;width:${MID}px;height:${H}px;overflow:hidden">
      ${ring(C.gold, LEFT - MID)}
    </div>

    <!-- 图标最后画，金线像是从它背后穿过去 -->
    <div class="abs" style="left:${MID}px;top:${(H - ICON) / 2}px;
         width:${ICON}px;height:${ICON}px;margin-left:${-ICON / 2}px;
         border-radius:${RADIUS}px;
         box-shadow:0 18px 42px rgba(16,19,26,.30), 0 2px 8px rgba(16,19,26,.18)">
      <img src="${fileUri(path.join(ROOT, 'icons', 'icon128.png'))}"
           style="width:${ICON}px;height:${ICON}px;display:block">
    </div>
  `, `body { width:${W}px; height:${H}px; background:#10131a; }`);
};

const htmlPromoLarge = () => page(`
    <div class="abs" style="inset:0;background:
      radial-gradient(760px 520px at 84% 8%, rgba(255,196,92,.13), transparent 68%),
      linear-gradient(160deg, #0f131b 0%, #0d1017 62%)"></div>

    <div class="abs" style="left:76px;top:146px;width:560px">
      <div style="display:flex;align-items:center;gap:16px">
        <img src="${fileUri(path.join(ROOT, 'icons', 'icon128.png'))}"
             style="width:74px;height:74px;border-radius:17px">
        <div>
          <div style="font-size:42px;font-weight:700;letter-spacing:.01em;line-height:1.12">入夜</div>
          <div style="font-size:16px;color:${C.gold};letter-spacing:.07em;margin-top:4px">Fall in Night</div>
        </div>
      </div>
      <div style="margin-top:28px;font-size:25px;line-height:1.55">
        在决定改之前<br>先看到改完是什么样
      </div>
      <div style="margin-top:18px;font-size:15px;color:${C.muted};letter-spacing:.02em">
        一键切换为暗色 · 图片保持原色 · 不到 30 KB
      </div>
    </div>

    <!-- 大图有 1400x560 的余量，放得下一整屏网页，所以这里上真实截图；
         小图没这个余量，改用纯色构图，两张图分工不同 -->
    <div class="abs" style="right:62px;top:61px;width:700px;height:438px;border-radius:14px;overflow:hidden;
         box-shadow:0 30px 74px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.07)">
      <div style="position:absolute;left:0;top:0;width:349px;height:438px;overflow:hidden">
        <img src="${fileUri(shot('sspai', 'before'))}"
             style="position:absolute;left:0;top:0;width:700px;height:438px;object-fit:cover;object-position:0 0">
      </div>
      <div style="position:absolute;left:351px;top:0;width:349px;height:438px;overflow:hidden">
        <img src="${fileUri(shot('sspai', 'after'))}"
             style="position:absolute;left:-351px;top:0;width:700px;height:438px;object-fit:cover;object-position:0 0">
      </div>
      <div style="position:absolute;left:348px;top:0;width:4px;height:438px;
           background:linear-gradient(to bottom, ${C.gold}, rgba(255,196,92,.5))"></div>
    </div>
  `, 'body { width:1400px; height:560px; }');

/* ---------- 主流程 ---------- */
// 只重生成某几张时，把名字（带不带 .png 都行）写在命令行后面
//   例：node tools/store-assets.js promo-small
let ONLY = [];
const want = (name) => !ONLY.length || ONLY.includes(name);

async function snap(browser, html, name, w, h) {
  if (!want(name.replace(/\.png$/, ''))) return;
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  // html 可以是函数：只在真要出这张图时才拼装，
  // 免得跳过某张时它的依赖（比如弹窗 buffer）还是 null 就被用了
  await p.setContent(typeof html === 'function' ? html() : html, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 260));
  const file = path.join(OUT, name);
  await p.screenshot({ path: file });
  await p.close();
  console.log('[生成] ' + name.padEnd(24) + w + 'x' + h + '  ' +
    (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
}

async function main() {
  ONLY = process.argv.slice(2).map((s) => s.replace(/\.png$/, ''));

  // 对比图与宣传图依赖预置的 1280x800 抓图；
  // 目录不存在时只生成界面类素材，不中断。
  const hasShots = ['sspai', 'netease', 'devpress'].every(
    (k) => fs.existsSync(shot(k, 'before')) && fs.existsSync(shot(k, 'after'))
  );
  if (!hasShots) {
    console.log('[跳过] 未找到 ' + SHOTS + ' 的底图，只生成界面类素材');
    console.log('       把 before/after 截图放进 test/fixtures/shots 即可补上');
  }

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-first-run', '--force-device-scale-factor=1', '--font-render-hinting=none']
  });

  try {
    // 弹窗单独渲染到临时 buffer，让「当前网站」与背景站点对得上
    const popupBuf = want('04-popup') ? await renderUI(browser, {
      page: 'popup.html',
      host: 'www.163.com',
      width: 320,
      height: 216,
      dsf: 2,
      allSites: false
    }) : null;
    const optionsBuf = want('05-options') ? await renderUI(browser, {
      page: 'options.html',
      host: 'sspai.com',
      width: 900,
      height: 1300,
      dsf: 1,
      fullPage: true,
      allSites: false
    }) : null;
    const optionsAllBuf = want('06-options-all') ? await renderUI(browser, {
      page: 'options.html',
      host: 'sspai.com',
      width: 900,
      height: 1500,
      dsf: 1,
      fullPage: true,
      allSites: true
    }) : null;

    // 小宣传图是纯色构图，不依赖任何截图，所以放在 hasShots 之外
    await snap(browser, htmlPromoSmall(), 'promo-small.png', 440, 280);

    if (hasShots) {
      await snap(browser, htmlSite(), '01-site.png', 1280, 800);
      await snap(browser, htmlCompare('sspai',
        '左边原样，右边入夜', '同一个页面、同一个滚动位置，只是换了一套颜色',
        'sspai.com'), '02-compare-sspai.png', 1280, 800);
      await snap(browser, htmlCompare('netease',
        '图片和视频不动，只有文字和背景翻过来', '彩色照片保持原样，所以不会出现反色的怪画面',
        'www.163.com'), '03-compare-163.png', 1280, 800);
      await snap(browser, () => htmlPopup(popupBuf), '04-popup.png', 1280, 800);
    }

    await snap(browser, () => htmlOptions(optionsBuf, '站点列表自己管', [
      '填域名就加，支持 *.example.com 覆盖整个域及其子域',
      '单条可以临时关掉，不必删除，改动立即生效',
      '免费 5 个站点，多数人用不到这个上限'
    ]), '05-options.png', 1280, 800);

    await snap(browser, () => htmlOptions(optionsAllBuf, '也可以全部入夜', [
      '打开「所有网站入夜」，其余站点一并变暗',
      '此时出现白名单，挑出来保持原样',
      'B 站这类需要精确原色的站点，丢进白名单'
    ]), '06-options-all.png', 1280, 800);

    if (hasShots) {
      await snap(browser, htmlPromoLarge(), 'promo-large.png', 1400, 560);
    }
  } finally {
    await browser.close();
  }

  console.log('\n[完成] 素材在 ' + OUT);
}

main().catch((err) => {
  console.error('[异常] ' + err.message);
  process.exit(1);
});
