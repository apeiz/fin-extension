/**
 * 入夜 - 工具栏弹窗
 * 只管两件事：总开关、当前站点开关。列表维护交给选项页。
 */
(function () {
  'use strict';

  var SD = window.SiteDark;

  var els = {
    global: document.getElementById('globalToggle'),
    site: document.getElementById('siteToggle'),
    host: document.getElementById('currentHost'),
    hint: document.getElementById('hint'),
    openOptions: document.getElementById('openOptions')
  };

  var host = '';
  var settings = null;

  function isInjectablePage(url) {
    return /^https?:\/\//i.test(url || '');
  }

  function render() {
    if (!settings) return;

    els.global.checked = settings.enabled !== false;

    var resolved = host ? SD.resolveHost(settings, host) : { enabled: false, source: 'none', rule: '' };
    els.site.checked = resolved.enabled;
    // 「所有网站入夜」模式下这个开关仍然可用，但语义变成「是否加入白名单」
    els.site.disabled = !host;

    els.hint.className = 'hint';
    if (!host) {
      els.host.textContent = '不适用于此页面';
      els.hint.textContent = '当前标签页不是普通网页，域名列表对它不起作用。';
    } else if (!settings.enabled) {
      els.hint.textContent = '总开关已关闭，所有站点都保持原样。';
      els.hint.classList.add('warn');
    } else if (resolved.source === 'whitelist') {
      els.hint.textContent =
        '此站点在白名单（' + resolved.rule + '）里，保持原样。打开开关会把它移出白名单。';
      els.hint.classList.add('warn');
    } else if (settings.allSites) {
      els.hint.textContent = '「所有网站入夜」已开启，此站点会变暗。关掉开关会把它加进白名单。';
    } else if (resolved.source === 'wildcard') {
      els.hint.textContent = '由通配规则 ' + resolved.rule + ' 覆盖。单独开关会在列表里生成一条精确记录，优先级高于通配。';
    } else if (resolved.enabled) {
      els.hint.textContent = '此站点已加入列表并生效。';
    } else if (resolved.source === 'exact') {
      els.hint.textContent = '此站点在列表里但已单独关闭。';
    } else {
      els.hint.textContent = '此站点不在列表里。打开开关即加入并立即生效。';
    }
  }

  /**
   * 切换当前站点的启用状态。
   *
   * 「所有网站入夜」模式下所有站点本来就生效，此时开关不去改站点列表，
   * 而是控制白名单：关掉即把当前站点加进白名单，打开即移出。
   * 其它模式下：已有精确条目就改它，没有就新增一条（精确条目优先于通配规则）。
   */
  function setSiteEnabled(value) {
    if (!host || !settings) return;

    if (settings.allSites) {
      var matched = SD.matchWhitelist(settings, host);
      if (value && matched) {
        var idx = settings.whitelist.indexOf(matched);
        if (idx >= 0) settings.whitelist.splice(idx, 1);
      } else if (!value && !matched) {
        settings.whitelist.push(host);
      }
      SD.writeSettings(settings, render);
      return;
    }

    var found = false;
    for (var i = 0; i < settings.sites.length; i++) {
      if (settings.sites[i].host === host) {
        settings.sites[i].enabled = value;
        found = true;
        break;
      }
    }
    if (!found) {
      settings.sites.push({ host: host, enabled: value });
    }

    SD.writeSettings(settings, render);
  }

  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0] ? tabs[0] : null;
      var url = tab && tab.url ? tab.url : '';

      host = isInjectablePage(url) ? SD.normalizeHost(url) : '';
      els.host.textContent = host || '不适用于此页面';
      els.host.title = url || '';

      SD.readSettings(function (s) {
        settings = s;
        render();
      });
    });

    els.global.addEventListener('change', function () {
      if (!settings) return;
      settings.enabled = els.global.checked;
      SD.writeSettings(settings, render);
    });

    els.site.addEventListener('change', function () {
      setSiteEnabled(els.site.checked);
    });

    els.openOptions.addEventListener('click', function () {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') });
      }
      window.close();
    });
  }

  if (SD) init();
})();
