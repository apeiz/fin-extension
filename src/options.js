/**
 * 入夜 - 选项页
 * 站点列表增删改 + 显示方式 + 自定义 CSS，改动即时写入 storage，content script 立刻响应。
 */
(function () {
  'use strict';

  var SD = window.SiteDark;

  var els = {
    list: document.getElementById('siteList'),
    empty: document.getElementById('emptyHint'),
    newHost: document.getElementById('newHost'),
    addBtn: document.getElementById('addBtn'),
    addNotice: document.getElementById('addNotice'),
    allSites: document.getElementById('allSites'),
    whitelistBlock: document.getElementById('whitelistBlock'),
    whitelistList: document.getElementById('whitelistList'),
    whitelistEmpty: document.getElementById('whitelistEmpty'),
    newWhitelist: document.getElementById('newWhitelist'),
    addWhitelistBtn: document.getElementById('addWhitelistBtn'),
    keepDarkBlocks: document.getElementById('keepDarkBlocks'),
    invertMedia: document.getElementById('invertMedia'),
    invertSvg: document.getElementById('invertSvg'),
    customCss: document.getElementById('customCss'),
    resetBtn: document.getElementById('resetBtn'),
    saveState: document.getElementById('saveState'),
    // 配额与授权
    siteQuota: document.getElementById('siteQuota'),
    wlQuota: document.getElementById('wlQuota'),
    licBadge: document.getElementById('licBadge'),
    licDesc: document.getElementById('licDesc'),
    licActive: document.getElementById('licActive'),
    licCode: document.getElementById('licCode'),
    licForm: document.getElementById('licForm'),
    licInput: document.getElementById('licInput'),
    licBtn: document.getElementById('licBtn'),
    licNotice: document.getElementById('licNotice'),
    licRemove: document.getElementById('licRemove')
  };

  var settings = null;
  var cssTimer = null;
  var stateTimer = null;
  var noticeTimer = null;
  var licTimer = null;

  /** 输入框下方的临时提示，几秒后自动消失 */
  function notice(text) {
    showNotice(els.addNotice, text, 'noticeTimer');
  }

  function licHint(text) {
    showNotice(els.licNotice, text, 'licTimer');
  }

  function showNotice(el, text, timerName) {
    el.textContent = text || '';
    el.hidden = !text;
    if (timerName === 'noticeTimer') {
      if (noticeTimer) clearTimeout(noticeTimer);
      if (text) {
        noticeTimer = setTimeout(function () {
          el.hidden = true;
        }, 6000);
      }
    } else {
      if (licTimer) clearTimeout(licTimer);
      if (text) {
        licTimer = setTimeout(function () {
          el.hidden = true;
        }, 6000);
      }
    }
  }

  /* ---------------- 配额与授权 ---------------- */

  function limits() {
    return SD.limitsFor(settings);
  }

  function quotaText(used, max) {
    return used + '/' + (max === Infinity ? '不限' : max);
  }

  function renderQuota() {
    var lim = limits();
    var sitesFull = settings.sites.length >= lim.sites;
    var wlFull = settings.whitelist.length >= lim.whitelist;

    els.siteQuota.textContent = quotaText(settings.sites.length, lim.sites);
    els.siteQuota.classList.toggle('full', sitesFull);
    els.wlQuota.textContent = quotaText(settings.whitelist.length, lim.whitelist);
    els.wlQuota.classList.toggle('full', wlFull);

    // 达上限只禁新增，已有条目照常使用
    els.addBtn.disabled = sitesFull;
    els.addBtn.textContent = sitesFull ? '已达上限' : '添加';
    els.newHost.disabled = sitesFull;
    els.newHost.placeholder = sitesFull
      ? '免费额度已用完'
      : '例如 www.joinquant.com 或 *.joinquant.com';

    els.addWhitelistBtn.disabled = wlFull;
    els.addWhitelistBtn.textContent = wlFull ? '已达上限' : '添加';
    els.newWhitelist.disabled = wlFull;
    els.newWhitelist.placeholder = wlFull
      ? '免费额度已用完'
      : '例如 www.bilibili.com 或 *.bilibili.com';
  }

  function renderLicense() {
    var on = !!settings.license;
    els.licBadge.textContent = on ? '已解锁' : '免费版';
    els.licBadge.classList.toggle('on', on);
    els.licDesc.textContent = on
      ? '站点与白名单数量不限'
      : '可保存 5 个站点、3 条白名单';
    els.licActive.hidden = !on;
    els.licForm.hidden = on;
    if (on) els.licCode.textContent = SD.licFormat(settings.license.code);
  }

  function activate() {
    var raw = SD.licNormalize(els.licInput.value);
    if (!raw) {
      licHint('授权码是 12 位，形如 YUE7-K3M9-PQ4T');
      els.licInput.focus();
      return;
    }
    if (!SD.licValid(raw)) {
      licHint('这个码校验不过，请核对后重试。如果确认无误，可能是抄漏了一位。');
      els.licInput.select();
      return;
    }
    settings.license = { code: raw, at: Date.now() };
    els.licInput.value = '';
    renderLicense();
    renderQuota();
    save();
    licHint('');
  }

  function deactivate() {
    settings.license = null;
    renderLicense();
    renderQuota();
    save();
    licHint('已恢复免费版额度，超出部分仍然保留，只是不能再新增。');
  }

  function flashSaved() {
    els.saveState.classList.add('show');
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(function () {
      els.saveState.classList.remove('show');
    }, 1200);
  }

  function save() {
    SD.writeSettings(settings, flashSaved);
  }

  function makeSwitch(checked, onChange, disabled) {
    var label = document.createElement('label');
    label.className = 'switch';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.disabled = !!disabled;
    input.addEventListener('change', function () {
      onChange(input.checked);
    });

    var slider = document.createElement('span');
    slider.className = 'slider';

    label.appendChild(input);
    label.appendChild(slider);
    return label;
  }

  function renderList() {
    els.list.textContent = '';
    renderQuota();

    if (settings.sites.length === 0) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    settings.sites.forEach(function (site, index) {
      var li = document.createElement('li');
      li.className = 'site-item' + (site.enabled ? '' : ' off');

      var name = document.createElement('span');
      name.className = 'site-host';
      name.textContent = site.host;
      name.title = site.host;

      var sw = makeSwitch(site.enabled, function (checked) {
        settings.sites[index].enabled = checked;
        li.className = 'site-item' + (checked ? '' : ' off');
        save();
      }, settings.allSites);

      var del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.title = '从列表中移除 ' + site.host;
      del.addEventListener('click', function () {
        settings.sites.splice(index, 1);
        renderList();
        save();
      });

      li.appendChild(name);
      li.appendChild(sw);
      li.appendChild(del);
      els.list.appendChild(li);
    });
  }

  function renderWhitelist() {
    els.whitelistList.textContent = '';
    renderQuota();

    if (settings.whitelist.length === 0) {
      els.whitelistEmpty.hidden = false;
      return;
    }
    els.whitelistEmpty.hidden = true;

    settings.whitelist.forEach(function (host, index) {
      var li = document.createElement('li');
      li.className = 'site-item';

      var name = document.createElement('span');
      name.className = 'site-host';
      name.textContent = host;
      name.title = host;

      var del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '移除';
      del.title = '从白名单中移除 ' + host;
      del.addEventListener('click', function () {
        settings.whitelist.splice(index, 1);
        renderWhitelist();
        save();
      });

      li.appendChild(name);
      li.appendChild(del);
      els.whitelistList.appendChild(li);
    });
  }

  function renderAll() {
    renderList();
    renderWhitelist();
    els.allSites.checked = settings.allSites === true;
    els.whitelistBlock.hidden = settings.allSites !== true;
    els.keepDarkBlocks.checked = settings.keepDarkBlocks !== false;
    els.invertMedia.checked = settings.invertMedia !== false;
    els.invertSvg.checked = settings.invertSvg === true;
    els.customCss.value = settings.customCss || '';
    renderLicense();
  }

  function addHost() {
    var host = SD.normalizeHost(els.newHost.value);

    if (!host) {
      els.newHost.focus();
      els.newHost.select();
      return;
    }

    // 完全相同的条目：直接启用，不新增
    for (var i = 0; i < settings.sites.length; i++) {
      if (settings.sites[i].host === host) {
        settings.sites[i].enabled = true;
        els.newHost.value = '';
        renderList();
        save();
        notice('这条规则已经在列表里，已直接启用。');
        return;
      }
    }

    // 已被现有通配规则覆盖（例如已有 *.163.com，再加 163.com）：
    // 通配本身就含裸域，再补一条精确条目是重复的，只提示不新增。
    var cover = SD.coveringRule(settings, host);
    if (cover) {
      els.newHost.value = '';
      notice(host + ' 已被 ' + cover + ' 覆盖，无需重复添加。');
      return;
    }

    // 配额检查放在最后：上面两条都不会新增条目，不该被额度拦住
    var max = limits().sites;
    if (settings.sites.length >= max) {
      notice('免费版最多保存 ' + max + ' 个站点。需要更多可以激活授权码，已有的站点都会保留。');
      return;
    }

    settings.sites.push({ host: host, enabled: true });
    els.newHost.value = '';
    renderList();
    save();
    notice('');
  }

  function addWhitelist() {
    var host = SD.normalizeHost(els.newWhitelist.value);

    if (!host) {
      els.newWhitelist.focus();
      els.newWhitelist.select();
      return;
    }

    if (settings.whitelist.indexOf(host) >= 0) {
      els.newWhitelist.value = '';
      return;
    }

    var wlMax = limits().whitelist;
    if (settings.whitelist.length >= wlMax) {
      notice('免费版最多保存 ' + wlMax + ' 条白名单。需要更多可以激活授权码。');
      return;
    }

    settings.whitelist.push(host);
    els.newWhitelist.value = '';
    renderWhitelist();
    save();
  }

  function init() {
    els.addBtn.addEventListener('click', addHost);
    els.addWhitelistBtn.addEventListener('click', addWhitelist);

    els.newHost.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addHost();
      }
    });

    els.newWhitelist.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addWhitelist();
      }
    });

    els.keepDarkBlocks.addEventListener('change', function () {
      settings.keepDarkBlocks = els.keepDarkBlocks.checked;
      save();
    });

    els.allSites.addEventListener('change', function () {
      settings.allSites = els.allSites.checked;
      // 开关切换会影响站点开关的可用状态，也会显示或隐藏白名单
      renderAll();
      save();
    });

    els.invertMedia.addEventListener('change', function () {
      settings.invertMedia = els.invertMedia.checked;
      save();
    });

    els.invertSvg.addEventListener('change', function () {
      settings.invertSvg = els.invertSvg.checked;
      save();
    });

    els.customCss.addEventListener('input', function () {
      if (cssTimer) clearTimeout(cssTimer);
      cssTimer = setTimeout(function () {
        settings.customCss = els.customCss.value;
        save();
      }, 500);
    });

    els.resetBtn.addEventListener('click', function () {
      // 恢复默认不动授权码：用户已经付过，重置设置不该把解锁也清掉
      var keep = settings.license;
      settings = SD.defaultSettings();
      settings.license = keep;
      renderAll();
      save();
    });

    els.licBtn.addEventListener('click', activate);
    els.licRemove.addEventListener('click', deactivate);
    els.licInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        activate();
      }
    });

    // popup 里改过开关时，这里同步刷新
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes.settings) return;
        settings = SD.normalizeSettings(changes.settings.newValue);
        renderAll();
      });
    } catch (e) {
      // 忽略
    }

    SD.readSettings(function (s) {
      settings = s;
      renderAll();
    });
  }

  if (SD) init();
})();
