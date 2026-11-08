/**
 * 界面预览截图（开发辅助）
 *
 * 扩展自身页面在自动化环境里无法直接导航，这里用 file:// 打开真实 HTML，
 * 并注入假的 chrome API，让列表和开关显示出真实内容后截图。
 * 改完 ui.css 后跑一次即可对比观感。
 *
 * 运行：node tools/preview-ui.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 扩展本身零依赖，截图工具借用网页应用已装的依赖，两者是同级目录
function loadDep(name) {
  try {
    return require(name);
  } catch (e) {
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
const ARTIFACTS = path.join(__dirname, '..', 'test', 'artifacts');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MOCK = `
(function () {
  var settings = {
    enabled: true,
    allSites: false,
    sites: [
      { host: '*.sspai.com', enabled: true },
      { host: '*.163.com', enabled: true },
      { host: '*.csdn.net', enabled: true }
    ],
    whitelist: ['*.bilibili.com', 'www.youtube.com'],
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
      query: function (q, cb) { setTimeout(function () { cb([{ url: 'https://www.joinquant.com/user/1024' }]); }, 0); },
      create: function () {}
    },
    storage: {
      local: {
        get: function (k, cb) { var r = {}; r[k] = JSON.parse(JSON.stringify(settings)); setTimeout(function () { cb(r); }, 0); },
        set: function (o, cb) { if (o.settings) settings = o.settings; if (cb) setTimeout(cb, 0); }
      },
      onChanged: { addListener: function () {} }
    }
  };
})();
`;

async function main() {
  if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-first-run', '--allow-file-access-from-files']
  });

  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(MOCK);

    // 选项页
    await page.setViewport({ width: 900, height: 1100 });
    await page.goto('file:///' + path.join(ROOT, 'src', 'options.html').replace(/\\/g, '/'), {
      waitUntil: 'load'
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(ARTIFACTS, 'ui-options.png'),
      fullPage: true
    });
    console.log('[生成] ui-options.png');

    // 打开「所有网站入夜」，再看一次站点开关置灰的效果
    await page.evaluate(function () {
      var el = document.getElementById('allSites');
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({
      path: path.join(ARTIFACTS, 'ui-options-all.png'),
      fullPage: true
    });
    console.log('[生成] ui-options-all.png');

    // 弹窗
    const popup = await browser.newPage();
    await popup.evaluateOnNewDocument(MOCK);
    await popup.setViewport({ width: 320, height: 260, deviceScaleFactor: 2 });
    await popup.goto('file:///' + path.join(ROOT, 'src', 'popup.html').replace(/\\/g, '/'), {
      waitUntil: 'load'
    });
    await new Promise((r) => setTimeout(r, 500));
    await popup.screenshot({ path: path.join(ARTIFACTS, 'ui-popup.png') });
    console.log('[生成] ui-popup.png');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[异常] ' + err.message);
  process.exit(1);
});
