/**
 * 站点暗色模式 - 内容脚本
 *
 * 在 document_start 执行（此时文档还没开始渲染），读取配置后立刻往 <html> 第一位插入样式，
 * 因此不会出现「先白后黑」的闪烁。命中不到白名单就不做任何事，页面保持原样。
 *
 * 这个脚本也运行在 iframe 内部（manifest 里 all_frames: true）。
 * 整屏 iframe 承载的站点（例如聚宽的研究环境）必须靠内部注入才能变暗：
 * 父级反色 + iframe 元素二次反转 + 内部反色 = 净一次反色（即暗色），
 * 而内部图片再反转一次（共四次）正好回到原色。
 */
(function () {
  'use strict';

  var SD = window.SiteDark;
  if (!SD) return;

  var STYLE_ID = 'sd-dark-style';
  var STORAGE_KEY = 'settings';
  var DARK_ATTR = SD.DARK_BLOCK_ATTR;

  // 页面扫描参数
  var MAX_CANDIDATES = 1500; // 单次扫描上限，防止超大页面卡顿
  var MAX_MARKED = 80;
  var DARK_LUM_MAX = 90; // 背景亮度低于此值才算「原本就是深色」
  var MIN_W = 240;
  var MIN_H = 24;

  var current = null; // 当前生效的配置
  var appliedCss = null; // 已写入 style 的内容，用于跳过重复写入
  var scanning = false;
  var scanTimer = null;
  var observer = null;
  var markedTotal = 0;

  function insertCss(css) {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      el.setAttribute('data-sd-dark', '1');
      var root = document.documentElement;
      if (!root) return false;
      // 插到最前面，尽量避免被站点自身样式表覆盖
      root.insertBefore(el, root.firstChild);
    }
    el.textContent = css;
    return true;
  }

  function removeCss() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ------------------------------------------------------------------ *
   * 页面扫描：识别「原本就是深色」的区块
   *
   * 整页反色会把深色导航条、深色页脚翻成亮色，在暗色页面上反而更刺眼。
   * 对这些区域再反转一次即可恢复原本的深色，区块内文字也回到浅色。
   * 识别依据是元素自身的不透明背景色亮度。
   *（毛玻璃那条亮斑问题不在这里处理，由 CSS 全局禁用 backdrop-filter 解决）
   * ------------------------------------------------------------------ */

  function clearMarks() {
    var dark = document.querySelectorAll('[' + DARK_ATTR + ']');
    for (var i = 0; i < dark.length; i++) dark[i].removeAttribute(DARK_ATTR);
  }

  /** 返回背景色亮度 0-255；透明或无法解析返回 -1 */
  function luminanceOf(color) {
    var m = String(color || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return -1;
    var alpha = m.length > 3 ? parseFloat(m[3]) : 1;
    if (!(alpha >= 0.6)) return -1;
    return (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000;
  }

  function scanPage() {
    if (!scanning || !document.body) return;
    if (!(current && current.keepDarkBlocks)) return;

    // 先扫语义标签（导航、页脚通常就是它们的活），再扫其它块级元素。
    // 长页面元素多，扫描预算有限，按文档顺序硬扫会把页面底部的页脚挤出去。
    var groups = [
      document.body.querySelectorAll(
        'header,footer,nav,aside,[role="banner"],[role="contentinfo"],[role="navigation"]'
      ),
      document.body.querySelectorAll('section,article,div,ul,ol,form,table')
    ];

    markedTotal = document.querySelectorAll('[' + DARK_ATTR + ']').length;
    var budget = MAX_CANDIDATES;
    for (var g = 0; g < groups.length && budget > 0; g++) {
      var list = groups[g];
      for (var i = 0; i < list.length && budget > 0; i++) {
        budget -= 1;
        markIfDark(list[i]);
      }
    }
  }

  function markIfDark(el) {
    if (markedTotal >= MAX_MARKED) return;
    if (el.hasAttribute(DARK_ATTR)) return;

    // 祖先已经被标记过就不再标，否则会叠加成三层反转
    var parent = el.parentElement;
    if (parent && parent.closest('[' + DARK_ATTR + ']')) return;

    var rect = el.getBoundingClientRect();
    if (rect.width < MIN_W || rect.height < MIN_H) return;

    var lum = luminanceOf(getComputedStyle(el).backgroundColor);
    if (lum < 0 || lum > DARK_LUM_MAX) return;

    el.setAttribute(DARK_ATTR, '');
    markedTotal += 1;

    // 额度用满之后不会再标新的，继续监听整个文档纯属浪费。
    // 对 SPA 这类频繁插节点的站点，这一条能省掉持续的回调开销。
    if (markedTotal >= MAX_MARKED) unwatchDom();
  }

  function scheduleScan() {
    if (!scanning || scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      if (!scanning) return;
      if (window.requestIdleCallback) {
        window.requestIdleCallback(scanPage, { timeout: 1000 });
      } else {
        scanPage();
      }
    }, 350);
  }

  function watchDom() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].addedNodes && records[i].addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function unwatchDom() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function startScan() {
    if (scanning) return;
    scanning = true;
    watchDom();

    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        function () {
          scanPage();
          scheduleScan();
        },
        { once: true }
      );
    } else {
      scanPage();
      scheduleScan();
    }
    // 图片、字体加载完后布局会变，补扫一次
    window.addEventListener('load', scheduleScan, { once: true });
  }

  function stopScan() {
    if (!scanning) return;
    scanning = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    unwatchDom();
    clearMarks();
  }

  function render(settings) {
    if (!settings || !SD.isEnabledFor(settings, location.hostname)) {
      stopScan();
      removeCss();
      appliedCss = null;
      return;
    }

    // 站点启用就扫描：毛玻璃修复不受开关控制，深色区块由 scanPage 内部判断
    startScan();
    if (!settings.keepDarkBlocks) {
      // 关掉深色区块时，已经打上的标记要立刻清掉
      var stale = document.querySelectorAll('[' + DARK_ATTR + ']');
      for (var i = 0; i < stale.length; i++) stale[i].removeAttribute(DARK_ATTR);
    }

    var css = SD.fullCss(settings);
    if (css === appliedCss) return;
    if (insertCss(css)) appliedCss = css;
  }

  // document_start 时 <html> 一般已经存在，但不保证，兜底等它出现
  function withRoot(fn) {
    if (document.documentElement) {
      fn();
      return;
    }
    var mo = new MutationObserver(function () {
      if (!document.documentElement) return;
      mo.disconnect();
      fn();
    });
    mo.observe(document, { childList: true, subtree: true });
  }

  function commit(settings) {
    current = settings;
    withRoot(function () {
      render(current);
    });
  }

  // 首次安装时 storage 还是空的，把默认配置落盘，选项页才有内容可看。
  // 旧版本保存的配置会被 normalizeSettings 迁移（例如把精确的 www 升级成通配子域），
  // 迁移结果与存储里的不一致时回写一次，保证之后读到的都是同一份。
  try {
    chrome.storage.local.get(STORAGE_KEY, function (res) {
      var err = chrome.runtime.lastError;
      if (err) {
        commit(SD.normalizeSettings(undefined));
        return;
      }
      var raw = res ? res[STORAGE_KEY] : undefined;
      var normalized = SD.normalizeSettings(raw);
      commit(normalized);

      if (raw === undefined || JSON.stringify(raw) !== JSON.stringify(normalized)) {
        chrome.storage.local.set({ settings: normalized });
      }
    });
  } catch (e) {
    // 扩展刚重载时上下文可能已失效，用默认值兜底
    commit(SD.normalizeSettings(undefined));
  }

  // 在 popup / 选项页改动后，已打开的页面立即跟着变，不用刷新
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      commit(SD.normalizeSettings(changes[STORAGE_KEY].newValue));
    });
  } catch (e) {
    // 同上
  }
})();
