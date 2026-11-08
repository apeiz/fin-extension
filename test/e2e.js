/**
 * 真实浏览器端到端测试（Chrome）
 *
 * 验证链路：扩展加载 -> content script 在页面上真实运行 -> 注入的滤镜真的生效
 *          -> 改配置后已打开页面即时响应 -> 移出列表后恢复原样
 *
 * 说明：Chrome 137 起移除了 --load-extension，137+ 需要走 CDP 安装未打包扩展；
 * 而通过 CDP 安装的扩展，其自身页面（chrome-extension://）不允许被直接导航，
 * 所以配置读写改成在 content script 的隔离上下文里调 chrome.storage 完成。
 * 界面交互（选项页、弹窗）另由 test/ui.test.js 用 jsdom 覆盖。
 *
 * 运行：npm run test:e2e（需要先 npm install，并装好 Chrome）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const png = require('./png.js');

const { loadDep } = require('./deps.js');

const puppeteer = loadDep('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const PORT = 8765;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

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

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const file = path.join(FIXTURES, urlPath === '/' ? 'demo.html' : urlPath.replace(/^\/+/, ''));
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** 在 content script 的隔离上下文里执行表达式（能访问 chrome.* API） */
async function isolatedEval(page, expression) {
  const client = await page.createCDPSession();
  const contexts = [];
  client.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await client.send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 300));

  const ctx = contexts.find((c) => c.auxData && c.auxData.type === 'isolated');
  if (!ctx) {
    await client.detach();
    throw new Error('页面上找不到 content script 的隔离上下文，扩展未在该页面运行');
  }

  const res = await client.send('Runtime.evaluate', {
    contextId: ctx.id,
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  await client.detach();

  if (res.exceptionDetails) {
    throw new Error('求值异常：' + (res.exceptionDetails.text || '') + ' ' + JSON.stringify(res.result));
  }
  return res.result.value;
}

function readState(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const style = document.getElementById('sd-dark-style');
    const canvas = document.getElementById('kline');
    const img = document.getElementById('testImg');
    const bar = document.getElementById('fixedBar');
    const footer = document.getElementById('siteFooter');
    const glass = document.getElementById('glassNav');
    const card = document.querySelector('.card');
    return {
      htmlFilter: getComputedStyle(html).filter,
      stylePresent: !!style,
      styleIsFirstChild: !!style && html.firstElementChild === style,
      styleText: style ? style.textContent : '',
      canvasFilter: canvas ? getComputedStyle(canvas).filter : '',
      imgFilter: img ? getComputedStyle(img).filter : '',
      bodyColor: getComputedStyle(document.body).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      cardBg: card ? getComputedStyle(card).backgroundColor : '',
      barTop: bar ? bar.getBoundingClientRect().top : null,
      barMarked: bar ? bar.hasAttribute('data-sd-dark-block') : false,
      footerMarked: footer ? footer.hasAttribute('data-sd-dark-block') : false,
      glassMarked: glass ? getComputedStyle(glass).backdropFilter !== 'none' : false,
      glassBackdrop: glass ? getComputedStyle(glass).backdropFilter : '',
      markedCount: document.querySelectorAll('[data-sd-dark-block]').length,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
}

function luminance(rgbText) {
  const m = (rgbText || '').match(/\d+/g);
  if (!m || m.length < 3) return -1;
  return (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000;
}

/** 采集关键元素在视口中的位置，供像素采样使用 */
function collectLayout(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    return {
      card: rect('.card'),
      para: rect('.card p'),
      bar: rect('#fixedBar'),
      canvas: rect('#kline'),
      footer: rect('#siteFooter'),
      glass: rect('#glassNav')
    };
  });
}

async function main() {
  if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true });

  const server = await startServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-'));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir,
    pipe: true,
    enableExtensions: [ROOT],
    args: ['--no-first-run', '--no-default-browser-check', '--window-size=1100,900']
  });

  try {
    await new Promise((r) => setTimeout(r, 1200));

    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800 });

    // ---------- 1. 未加入列表：页面必须保持原样 ----------
    await page.goto('http://127.0.0.1:' + PORT + '/demo.html', { waitUntil: 'load' });
    const before = await readState(page);
    await page.screenshot({ path: path.join(ARTIFACTS, '01-original.png') });

    check('默认列表不含本地测试站，页面完全不被改动', () => {
      assert(before.htmlFilter === 'none', '期望 filter 为 none，实际 ' + before.htmlFilter);
      assert(!before.stylePresent, '不应存在注入的 style 标签');
    });

    // ---------- 2. content script 是否真的在这个页面运行 ----------
    const stored = await isolatedEval(page, "chrome.storage.local.get('settings')");
    const settings = stored && stored.settings;

    check('content script 在页面上运行，可读写扩展存储', () => {
      assert(settings !== undefined, '读不到 settings，content script 可能未运行');
    });

    check('首次安装的默认配置与网页应用一致', () => {
      assert(settings && settings.enabled === true, '总开关默认应开启');
      assert(
        settings.sites.length === 3 &&
          settings.sites.map((x) => x.host).join('|') === '*.163.com|*.csdn.net|*.sspai.com',
        '实际列表：' + JSON.stringify(settings && settings.sites)
      );
      assert(settings.invertMedia === true, '默认应开启图片/画布还原');
      assert(settings.invertSvg === false, '默认不应反转 svg');
    });

    // ---------- 3. 加入列表后，已打开的页面应即时变暗 ----------
    const next = JSON.parse(JSON.stringify(settings));
    next.sites.push({ host: '127.0.0.1', enabled: true });
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(next) + '})');
    await new Promise((r) => setTimeout(r, 400));

    const after = await readState(page);
    await page.screenshot({ path: path.join(ARTIFACTS, '02-dark.png') });

    check('改配置后无需刷新，页面即时变暗', () => {
      assert(/invert\(0\.92\)/.test(after.htmlFilter), '实际 filter：' + after.htmlFilter);
      assert(/hue-rotate\(180deg\)/.test(after.htmlFilter), '实际 filter：' + after.htmlFilter);
    });

    check('注入的 style 是 html 的第一个子节点，样式优先级最高', () => {
      assert(after.stylePresent, 'style 标签不存在');
      assert(after.styleIsFirstChild, 'style 不是 html 的第一个子元素');
    });

    check('注入的 CSS 同时包含整页反色与媒体还原两段规则', () => {
      assert(/html\{background-color:#fff/.test(after.styleText), '缺少根元素规则');
      assert(/canvas/.test(after.styleText), '缺少 canvas 还原规则');
      assert(/svg image/.test(after.styleText), '缺少 svg 内嵌图片还原规则');
    });

    check('图片与画布被二次反转，K 线红绿不会颠倒', () => {
      assert(/invert\(0\.92\)/.test(after.canvasFilter), 'canvas filter：' + after.canvasFilter);
      assert(/invert\(0\.92\)/.test(after.imgFilter), 'img filter：' + after.imgFilter);
    });

    // 滤镜属于渲染层效果，computed style 读到的仍是原始颜色，只能看截图像素
    const layout = await collectLayout(page);
    const imgOriginal = png.decode(fs.readFileSync(path.join(ARTIFACTS, '01-original.png')));
    const imgDark = png.decode(fs.readFileSync(path.join(ARTIFACTS, '02-dark.png')));

    // 卡片右下角的内边距区域，纯背景、不含文字
    const bgPoint = { x: layout.card.x + layout.card.w - 26, y: layout.card.y + layout.card.h - 12 };
    const bgOriginal = png.luminanceAt(imgOriginal, bgPoint.x, bgPoint.y);
    const bgDark = png.luminanceAt(imgDark, bgPoint.x, bgPoint.y);
    const paraOriginal = png.regionStats(imgOriginal, layout.para);
    const paraDark = png.regionStats(imgDark, layout.para);
    const meanOriginal = png.imageMean(imgOriginal);
    const meanDark = png.imageMean(imgDark);

    check('卡片背景由白翻黑（按截图实际像素）', () => {
      assert(bgOriginal > 200, '原图卡片背景亮度 ' + bgOriginal.toFixed(0) + '，应接近白色');
      assert(bgDark < 80, '暗色后卡片背景亮度 ' + bgDark.toFixed(0) + '，仍是亮的');
    });

    check('正文变成浅色字压深色底，且对比清晰', () => {
      // 原图：白色背景 + 深色字，区域内最暗的像素就是文字
      assert(paraOriginal.min < 120, '原图文字不够深，最暗像素 ' + paraOriginal.min.toFixed(0));
      // 暗色后关系反转：背景变暗，文字变亮
      assert(paraDark.max > 110, '区域内最亮像素仅 ' + paraDark.max.toFixed(0) + '，没有浅色文字');
      assert(paraDark.min < 90, '区域内最暗像素 ' + paraDark.min.toFixed(0) + '，背景不够暗');
      assert(
        paraDark.max - paraDark.min > 60,
        '文字与背景亮度差仅 ' + (paraDark.max - paraDark.min).toFixed(0)
      );
    });

    check('整页平均亮度明显下降', () => {
      assert(
        meanOriginal - meanDark > 80,
        '原图均值 ' + meanOriginal.toFixed(0) + '，暗色后 ' + meanDark.toFixed(0) + '，降幅不足'
      );
    });

    // ---------- 原本深色的区块要恢复成本来的深色 ----------
    // 导航条右侧的内边距区域，纯背景、不含文字
    const barPoint = { x: layout.bar.x + layout.bar.w - 40, y: layout.bar.y + layout.bar.h / 2 };
    const barOriginal = png.luminanceAt(imgOriginal, barPoint.x, barPoint.y);
    const barDark = png.luminanceAt(imgDark, barPoint.x, barPoint.y);

    check('原本深色的导航条/页脚被识别并打上标记', () => {
      assert(after.barMarked, 'header 没有被标记为深色区块');
      assert(after.footerMarked, 'footer 没有被标记为深色区块');
    });

    check('深色导航条恢复成本来的深色，不再是亮块（按像素）', () => {
      assert(barOriginal < 90, '原图导航条亮度 ' + barOriginal.toFixed(0) + '，本应是深色');
      assert(barDark < 90, '暗色后导航条亮度 ' + barDark.toFixed(0) + '，仍然是亮块');
    });

    // 毛玻璃元素在祖先 filter 下采样失效，只剩半透明白底，会形成亮斑
    const glassPoint = { x: layout.glass.x + 26, y: layout.glass.y + 12 };
    const glassOriginal = png.luminanceAt(imgOriginal, glassPoint.x, glassPoint.y);
    const glassDark = png.luminanceAt(imgDark, glassPoint.x, glassPoint.y);

    check('毛玻璃效果的 backdrop-filter 被禁用（否则会退化成亮斑）', () => {
      assert(after.glassBackdrop === 'none', 'backdrop-filter 实际为 ' + after.glassBackdrop);
      assert(!after.glassMarked, 'backdrop-filter 仍然生效');
    });

    check('毛玻璃那块不再变成亮斑（按像素）', () => {
      assert(glassOriginal > 200, '原图毛玻璃区域亮度 ' + glassOriginal.toFixed(0) + '，本应接近白');
      assert(glassDark < 110, '暗色后毛玻璃区域亮度 ' + glassDark.toFixed(0) + '，仍是亮斑');
    });

    // 关掉这一项，复现用户看到的现象，确认开关确实作用于它
    const noBlocks = JSON.parse(JSON.stringify(next));
    noBlocks.keepDarkBlocks = false;
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(noBlocks) + '})');
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACTS, '06-no-dark-blocks.png') });
    const imgNoBlocks = png.decode(fs.readFileSync(path.join(ARTIFACTS, '06-no-dark-blocks.png')));
    const barNoBlocks = png.luminanceAt(imgNoBlocks, barPoint.x, barPoint.y);

    check('关掉「保留原本深色区块」后，导航条又变成亮块（对照）', () => {
      assert(
        barNoBlocks > 150,
        '关闭后导航条亮度 ' + barNoBlocks.toFixed(0) + '，本应变亮才能证明开关有效'
      );
    });

    // 恢复设置，后面的用例继续用
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(next) + '})');
    await new Promise((r) => setTimeout(r, 400));

    check('固定导航栏仍贴在视口顶部（未滚动）', () => {
      assert(after.barTop === 0, '导航栏 top = ' + after.barTop);
    });

    // filter 会让元素成为 fixed 元素的包含块，滚动后最容易暴露定位问题
    await page.evaluate(() => window.scrollTo(0, 640));
    await new Promise((r) => setTimeout(r, 250));
    const barTopScrolled = await page.evaluate(
      () => document.getElementById('fixedBar').getBoundingClientRect().top
    );
    await page.screenshot({ path: path.join(ARTIFACTS, '05-scrolled.png') });

    check('滚动后固定导航栏仍吸附在视口顶部（filter 的已知副作用的实测）', () => {
      assert(barTopScrolled === 0, '滚动 640px 后导航栏 top = ' + barTopScrolled);
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 200));

    // ---------- 4. 同端口不同 host 不受影响 ----------
    await page.goto('http://localhost:' + PORT + '/demo.html', { waitUntil: 'load' });
    const otherHost = await readState(page);
    await page.screenshot({ path: path.join(ARTIFACTS, '03-other-host.png') });

    check('换成 localhost 访问同一页面则保持原样（只按域名命中）', () => {
      assert(otherHost.htmlFilter === 'none', 'localhost 被误命中，filter=' + otherHost.htmlFilter);
    });

    // ---------- 5. 移出列表后即时恢复 ----------
    await page.goto('http://127.0.0.1:' + PORT + '/demo.html', { waitUntil: 'load' });
    const removed = JSON.parse(JSON.stringify(settings));
    removed.sites.push({ host: '127.0.0.1', enabled: false });
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(removed) + '})');
    await new Promise((r) => setTimeout(r, 400));

    const restored = await readState(page);
    await page.screenshot({ path: path.join(ARTIFACTS, '04-restored.png') });

    check('把站点关掉后立即恢复原样，style 标签被移除', () => {
      assert(restored.htmlFilter === 'none', 'filter 仍为 ' + restored.htmlFilter);
      assert(!restored.stylePresent, 'style 标签未被移除');
    });

    // ---------- 6. 总开关 ----------
    const globalOff = JSON.parse(JSON.stringify(settings));
    globalOff.enabled = false;
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(globalOff) + '})');
    await new Promise((r) => setTimeout(r, 300));
    const offState = await readState(page);

    check('总开关关闭时，即使站点在列表里也不生效', () => {
      assert(offState.htmlFilter === 'none', 'filter = ' + offState.htmlFilter);
    });

    // ---------- 7. 整屏 iframe 承载的应用（聚宽研究环境的结构） ----------
    await isolatedEval(page, 'chrome.storage.local.set({settings:' + JSON.stringify(next) + '})');
    await new Promise((r) => setTimeout(r, 300));

    await page.goto('http://127.0.0.1:' + PORT + '/frame-parent.html', { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));

    const parentState = await readState(page);
    const childFrame = page.frames().find((f) => f.url().indexOf('frame-child.html') >= 0);
    let childState = null;
    if (childFrame) {
      childState = await childFrame.evaluate(() => {
        const html = document.documentElement;
        const style = document.getElementById('sd-dark-style');
        return {
          filter: getComputedStyle(html).filter,
          stylePresent: !!style,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          barMarked: !!document.getElementById('childBar') &&
            document.getElementById('childBar').hasAttribute('data-sd-dark-block')
        };
      });
    }

    await page.screenshot({ path: path.join(ARTIFACTS, '07-iframe.png') });
    const imgFrame = png.decode(fs.readFileSync(path.join(ARTIFACTS, '07-iframe.png')));

    check('同域 iframe 内部也注入了暗色（不再整块保持亮色）', () => {
      assert(childFrame, '没有找到 frame-child.html 子框架');
      assert(childState.stylePresent, 'iframe 内部没有注入 style');
      assert(/invert\(0\.92\)/.test(childState.filter), 'iframe 内部 filter：' + childState.filter);
    });

    check('iframe 区域按像素核对确实变暗了', () => {
      assert(/invert\(0\.92\)/.test(parentState.htmlFilter), '父页面 filter 未生效：' + parentState.htmlFilter);
      // iframe 内的白底区域：父级反色 + iframe 二次反转 + 内部反色 = 净一次反色 = 黑
      const inside = png.luminanceAt(imgFrame, 700, 260);
      assert(inside < 60, 'iframe 内白底区域亮度 ' + inside.toFixed(0) + '，仍是亮的');
    });

    check('iframe 内部的深色工具条也被识别，恢复成本来的深色', () => {
      assert(childState.barMarked, '子页面深色工具条没有被标记');
    });

    console.log('');
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    console.log('截图目录：' + ARTIFACTS);
  } finally {
    await browser.close();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      // 临时目录删不掉不影响结论
    }
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[异常] ' + err.message);
  process.exit(1);
});
