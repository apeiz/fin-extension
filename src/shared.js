/**
 * 入夜 - 共享逻辑
 *
 * content script / popup / options 三处复用同一份配置解析与匹配规则，
 * 避免三处各写一套导致「开关显示已开但页面没变暗」这类不一致。
 */
(function (global) {
  'use strict';

  // 首次安装时的默认站点，与网页应用（fall-in-night）的示例保持一致。
  // 用通配：这些站点的子域（news.163.com、fund 之类）经常承载 iframe，只写 www 会漏。
  var DEFAULT_SITES = [
    { host: '*.163.com', enabled: true },
    { host: '*.csdn.net', enabled: true },
    { host: '*.sspai.com', enabled: true }
  ];

  // 整页反色的核心滤镜：先反相，再旋转 180 度色相，让彩色（红绿）回到原本的色系。
  //
  // invert 强度不用 1：invert 是线性映射，白底与深色字的结果互补（两者恒和 255），
  // 用 1 会得到纯黑底（0,0,0），死板且刺眼；0.92 让白底落在 #141414。
  // 实测（截图逐像素采样）：白底 20,20,20 / 正文 #1a1a1a -> 213,213,213（对比度 12.6:1）
  //                      涨红 255,136,136、跌绿 71,165,98，色相均保持
  var FLIP = 'filter:invert(0.92) hue-rotate(180deg) !important;';

  // 标题容器里的图片：站点常把大标题做成「透明底 + 深色文字」的位图，
  // 这类图本质是文字，走「媒体二次反转」会保留原本的深色，压在深色底上就看不见了。
  // 所以不给它们二次反转，让它们跟着整页一起反色。
  var TITLE_MEDIA_SEL =
    'h1 img,h2 img,h3 img,h4 img,h5 img,h6 img,' +
    '[role="heading"] img,' +
    '[class*="title"] img,[class*="heading"] img,[class*="logo"] img,' +
    'img[class*="logo"],img[class*="title"],img[class*="brand"]';

  // 深色区块的标记属性，由 dark.js 写在元素上，供上面的 CSS 命中
  var DARK_BLOCK_ATTR = 'data-sd-dark-block';

  /* ------------------------------------------------------------------ *
   * 授权码
   *
   * 12 位，形如 YUE7-K3M9-PQ4T，前三组各 4 位，最后一组是校验位。
   * 校验用 FNV-1a 变体加盐，只防「随手编一个」，不防读源码的人 ——
   * 这是有意的取舍：本地校验无论如何都能被绕过（改代码或改存储），
   * 与其堆防护不如把体验做顺。真被滥用时换盐、重发码即可。
   *
   * 字母表去掉了 I L O 0 1，避免手抄时看错。
   * ------------------------------------------------------------------ */

  // 32 个字符，必须是 32 —— licEncode 用 % 32 取位，少一个就会在边界上取到空串，
  // 生成的码会静默少一位。去掉 I L O 0，避免手抄时与 1 0 混淆。
  var LIC_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ123456789';
  var LIC_LEN = 12;
  var LIC_SALT = 'fin/2026-11';

  // 免费额度。达到上限只禁止新增，已有条目一律保留。
  var LIMITS = { sites: 5, whitelist: 3 };

  function licChecksum(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function licEncode(num, len) {
    var out = '';
    for (var i = 0; i < len; i++) {
      out = LIC_ALPHA.charAt(num % 32) + out;
      num = Math.floor(num / 32);
    }
    return out;
  }

  /** 把任意写法收敛成 12 位大写字母数字；长度不对返回空串 */
  function licNormalize(code) {
    var raw = String(code == null ? '' : code)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return raw.length === LIC_LEN ? raw : '';
  }

  function licValid(code) {
    var raw = licNormalize(code);
    if (!raw) return false;
    var body = raw.slice(0, 8);
    var tail = raw.slice(8);
    return tail === licEncode(licChecksum(body + LIC_SALT), 4);
  }

  /** 生成一个码。仅供本地发码脚本使用，扩展运行时用不到。 */
  function licMake(body) {
    var raw = String(body == null ? '' : body).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 8) return '';
    return raw + licEncode(licChecksum(raw + LIC_SALT), 4);
  }

  /** 显示成 YUE7-K3M9-PQ4T 便于抄写；内部一律存无分隔符形式 */
  function licFormat(code) {
    var raw = licNormalize(code);
    if (!raw) return '';
    return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
  }

  /** 存储里的 license 字段收敛。校验不过一律当未激活。 */
  function normalizeLicense(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var rawCode = licNormalize(raw.code);
    if (!rawCode || !licValid(rawCode)) return null;
    return { code: rawCode, at: Number(raw.at) || 0 };
  }

  /** 当前生效的额度。已激活则不设上限。 */
  function limitsFor(settings) {
    if (settings && settings.license) return { sites: Infinity, whitelist: Infinity };
    return { sites: LIMITS.sites, whitelist: LIMITS.whitelist };
  }

  function defaultSettings() {
    return {
      enabled: true,
      allSites: false,
      sites: DEFAULT_SITES.map(function (s) {
        return { host: s.host, enabled: s.enabled };
      }),
      // 白名单：只在「所有网站入夜」打开时生效，列入的站点保持原样。
      // 存成字符串数组，元素可以是精确域或 *.example.com。
      whitelist: [],
      invertMedia: true,
      invertSvg: false,
      keepDarkBlocks: true,
      customCss: '',
      // 激活后为 { code, at }，未激活为 null
      license: null
    };
  }

  /**
   * 把用户输入的任意写法规范成 host：
   *   https://www.joinquant.com/abc?x=1  -> www.joinquant.com
   *   WWW.JoinQuant.com:8080             -> www.joinquant.com
   *   *.joinquant.com                    -> *.joinquant.com（通配子域，原样保留）
   */
  function normalizeHost(input) {
    var host = String(input == null ? '' : input).trim().toLowerCase();
    if (!host) return '';

    host = host.replace(/^[a-z][a-z0-9+.\-]*:\/\//, ''); // 协议
    host = host.split('/')[0];                            // 路径
    host = host.split('?')[0];
    host = host.split('#')[0];
    host = host.split('@').pop();                          // user@ 前缀
    host = host.replace(/:\d+$/, '');                      // 端口
    if (!host) return '';

    if (host.slice(0, 2) === '*.') {
      var base = host.slice(2);
      return base ? '*.' + base : '';
    }
    return host;
  }

  /**
   * 规则匹配。规则可以是精确 host，也可以是 *.example.com 形式（含裸域本身）。
   */
  function hostMatch(host, rule) {
    if (!host || !rule) return false;
    if (rule.slice(0, 2) === '*.') {
      var base = rule.slice(2);
      if (!base) return false;
      return host === base || host.slice(-(base.length + 1)) === '.' + base;
    }
    return host === rule;
  }

  /**
   * 找出命中白名单的条目（无则空串）。白名单支持 *.example.com 写法。
   */
  function matchWhitelist(settings, host) {
    var list = (settings && settings.whitelist) || [];
    for (var i = 0; i < list.length; i++) {
      if (hostMatch(host, list[i])) return list[i];
    }
    return '';
  }

  /**
   * 判断 rule 是否已被现有条目完全覆盖，返回覆盖它的那条规则（无则空串）。
   *
   * 用来避免「*.163.com 与 163.com 并存」这类冗余条目：通配规则本身就含裸域，
   * 再补一条精确的属于重复。注意方向是单向的 —— *.163.com 覆盖 163.com，
   * 反过来不成立（外加一条通配会扩大范围，要允许）。
   */
  function coveringRule(settings, rule) {
    rule = normalizeHost(rule);
    if (!rule) return '';
    var list = (settings && settings.sites) || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !s.host) continue;
      if (s.host === rule) return s.host;
      if (s.host.slice(0, 2) === '*.' && rule.slice(0, 2) !== '*.') {
        if (hostMatch(rule, s.host)) return s.host;
      }
    }
    return '';
  }

  /**
   * 解析某个 host 的最终状态。
   * 精确条目优先于通配条目 —— 这样「*.joinquant.com 全站开启 + 单独关掉 www.joinquant.com」可以成立。
   */
  function resolveHost(settings, host) {
    host = normalizeHost(host);
    if (!host) return { enabled: false, source: 'none', rule: '' };

    // 「所有网站入夜」打开时，任何可识别的站点都直接生效，
    // 站点列表里的具体开关不再参与判断（界面里也会把它们置灰）。
    // 白名单是这条规则唯一的例外，所以先查它。
    if (settings.allSites) {
      var wl = matchWhitelist(settings, host);
      if (wl) return { enabled: false, source: 'whitelist', rule: wl };
      return { enabled: true, source: 'all', rule: '' };
    }

    var exact = null;
    var wildEnabled = false;
    var wildRule = '';

    for (var i = 0; i < settings.sites.length; i++) {
      var s = settings.sites[i];
      if (!s || !s.host) continue;
      if (s.host === host) {
        if (!exact) exact = s;
        continue;
      }
      if (s.enabled && hostMatch(host, s.host)) {
        wildEnabled = true;
        if (!wildRule) wildRule = s.host;
      }
    }

    if (exact) {
      return { enabled: exact.enabled !== false, source: 'exact', rule: exact.host };
    }
    return {
      enabled: wildEnabled,
      source: wildEnabled ? 'wildcard' : 'none',
      rule: wildRule
    };
  }

  function isEnabledFor(settings, host) {
    if (!settings.enabled) return false;
    return resolveHost(settings, host).enabled;
  }

  /**
   * 生成注入用的 CSS。
   *
   * 为什么用 invert 滤镜而不是逐元素覆盖颜色：
   * 通用站点结构不可预知，逐元素改色必然漏掉一部分（内联样式、JS 动态生成的节点），
   * 结果是「大部分变暗、局部刺眼白块」。整页反色对任意站点一次到位。
   *
   * 代价是位图也会被反成负片，所以图片、视频、画布、iframe 再反转回来。
   * 画布必须反转，否则 K 线图的红绿会颠倒 —— 那是错误的行情信息。
   */
  function fullCss(settings) {
    var parts = [];

    // 先把 html 背景压成白色，反色后就是纯黑，避免部分站点背景透明导致泛灰
    parts.push('html{background-color:#fff !important;' + FLIP + '}');

    if (settings.invertMedia) {
      // 注意：picture 不能进这份名单。它只是 <img> 的容器、不渲染任何像素，
      // 给它加 filter 会让里面的 img 经历 img自身 -> picture -> html 三次反转，
      // 色相三次恰等于翻转一次，直接负片（bilibili 首页近半图片用 picture 包裹，实测触发）。
      parts.push(
        'img,video,canvas,iframe,embed,object,svg image,input[type="image"]{' +
          FLIP +
          '}'
      );
      // 例外：标题容器里的图片本质是文字，不还原，跟着页面一起反色
      parts.push(TITLE_MEDIA_SEL + '{filter:none !important}');
    }

    if (settings.invertSvg) {
      // 默认不反转 svg：内联 svg 多用于图标，跟随父级反色后在暗底上才看得见。
      // 但 K 线类 svg 图表会因此红绿颠倒，需要精确配色时手动开启这一项。
      parts.push('svg{' + FLIP + '}');
    }

    if (settings.keepDarkBlocks) {
      // 本来就是深色的区块（深色导航条、深色页脚）被整页反色后会变成亮块，很刺眼。
      // 对这些区块再反转一次即可恢复成原本的深色，文字也跟着回到浅色。
      // 区块内部的媒体元素此时已经被反转了两次（父级 + 区块），再加上自身的二次反转
      // 就成了三次，会变成负片，所以要在这里把它们的 filter 清掉。
      parts.push('[data-sd-dark-block]{' + FLIP + '}');
      parts.push(
        '[data-sd-dark-block] img,[data-sd-dark-block] video,[data-sd-dark-block] canvas,' +
          '[data-sd-dark-block] iframe,[data-sd-dark-block] embed,[data-sd-dark-block] object,' +
          '[data-sd-dark-block] svg image{filter:none !important}'
      );
    }

    // 毛玻璃（backdrop-filter）在祖先 filter 之下采样会失效，元素只剩半透明白底，
    // 于是整个变成一块亮斑（聚宽首页那条导航就是这种写法）。
    // 直接全局禁用：这类效果在暗色下本来也看不出来，而且它是主要的渲染性能开销。
    parts.push('*{-webkit-backdrop-filter:none !important;backdrop-filter:none !important}');

    var css = parts.join('\n');
    if (settings.customCss && settings.customCss.trim()) {
      css += '\n/* 用户自定义修正 */\n' + settings.customCss.trim();
    }
    return css;
  }

  /**
   * 把 storage 里读到的任意值收敛成合法配置。
   * 注意：sites 是空数组时保留空数组（用户就是想把列表清空），
   * 只有 sites 不是数组（从未配置过 / 数据损坏）才回退到默认站点。
   */
  function normalizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;

    var out = {
      enabled: raw.enabled !== false,
      allSites: raw.allSites === true,
      invertMedia: raw.invertMedia !== false,
      invertSvg: raw.invertSvg === true,
      keepDarkBlocks: raw.keepDarkBlocks !== false,
      customCss: typeof raw.customCss === 'string' ? raw.customCss : '',
      license: normalizeLicense(raw.license),
      sites: [],
      whitelist: []
    };

    if (Array.isArray(raw.sites)) {
      var seen = {};
      for (var i = 0; i < raw.sites.length; i++) {
        var item = raw.sites[i];
        var host = '';
        var on = true;
        if (typeof item === 'string') {
          host = item;
        } else if (item && typeof item === 'object') {
          host = typeof item.host === 'string' ? item.host : '';
          on = item.enabled !== false;
        }
        host = normalizeHost(host);
        if (!host || seen[host]) continue;
        seen[host] = 1;
        out.sites.push({ host: host, enabled: on });
      }
    } else {
      out.sites = d.sites;
    }

    // 白名单：字符串数组，清洗后去重
    if (Array.isArray(raw.whitelist)) {
      var seenWl = {};
      for (var w = 0; w < raw.whitelist.length; w++) {
        var item = raw.whitelist[w];
        var wHost = normalizeHost(typeof item === 'string' ? item : item && item.host);
        if (!wHost || seenWl[wHost]) continue;
        seenWl[wHost] = 1;
        out.whitelist.push(wHost);
      }
    }

    // 旧默认只有一条聚宽规则（精确 www 或通配）。默认站点换成 163 / csdn / sspai
    // 之后，仍是这条未改过的旧默认就升级成新默认；用户自己维护过的列表一律不动。
    var isOldJoinquantDefault =
      out.sites.length === 1 &&
      out.sites[0].enabled &&
      (out.sites[0].host === 'www.joinquant.com' || out.sites[0].host === '*.joinquant.com');
    if (isOldJoinquantDefault) {
      out.sites = d.sites;
    }

    return out;
  }

  function readSettings(cb) {
    try {
      chrome.storage.local.get('settings', function (res) {
        var err = chrome.runtime.lastError;
        cb(normalizeSettings(!err && res ? res.settings : undefined));
      });
    } catch (e) {
      cb(normalizeSettings(undefined));
    }
  }

  function writeSettings(settings, cb) {
    try {
      chrome.storage.local.set({ settings: settings }, function () {
        if (cb) cb();
      });
    } catch (e) {
      if (cb) cb();
    }
  }

  global.SiteDark = {
    DEFAULT_SITES: DEFAULT_SITES,
    DARK_BLOCK_ATTR: DARK_BLOCK_ATTR,
    LIMITS: LIMITS,
    LIC_ALPHA: LIC_ALPHA,
    defaultSettings: defaultSettings,
    normalizeHost: normalizeHost,
    hostMatch: hostMatch,
    matchWhitelist: matchWhitelist,
    coveringRule: coveringRule,
    resolveHost: resolveHost,
    isEnabledFor: isEnabledFor,
    fullCss: fullCss,
    normalizeSettings: normalizeSettings,
    readSettings: readSettings,
    writeSettings: writeSettings,
    licNormalize: licNormalize,
    licValid: licValid,
    licMake: licMake,
    licFormat: licFormat,
    normalizeLicense: normalizeLicense,
    limitsFor: limitsFor
  };
})(typeof window !== 'undefined' ? window : this);
