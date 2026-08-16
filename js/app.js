/* ==================== 身边有展 · 核心逻辑 ==================== */
(function () {
  'use strict';

  var EVENTS = window.EVENTS || [];
  var NEIGHBORS = window.CITY_NEIGHBORS || {};
  var CITIES = window.CITIES || [];
  var PREF_CATS = window.PREF_CATEGORIES || [];

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('sbyz_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('sbyz_' + k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- 全局状态 ----------
  var state = {
    city: LS.get('city', '上海'),
    prefs: LS.get('prefs', []),
    onbDone: LS.get('onbDone', false),
    view: 'feed',
    dateStrip: (function () { var s = LS.get('dateStrip', null); return s === 'today' ? null : s; })(), // null=今天 | 'all' | 'YYYY-MM-DD'
    selDate: null,     // 日历选中日期 'YYYY-MM-DD'
    calYm: null,       // 日历当前年月 'YYYY-MM'
    saved: LS.get('saved', []), // 已收藏活动 id
    selEv: null        // 抽屉中的活动
  };

  // ---------- 工具 ----------
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var toDate = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var fmt = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  var WEEKS = ['日', '一', '二', '三', '四', '五', '六'];
  var MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  var today = new Date();
  var todayStr = fmt(today);

  function rankOf(city) {
    if (city === state.city) return 0;
    var nb = NEIGHBORS[state.city] || [];
    if (nb.indexOf(city) !== -1) return 1;
    return 2;
  }
  function rankLabel(r) { return r === 0 ? '同城' : r === 1 ? '邻城' : '更远'; }
  function isOngoing(ev) { return ev.start <= todayStr && ev.end >= todayStr; }
  function isUpcoming(ev) { return ev.start > todayStr; }
  function matchPref(ev) {
    if (!state.prefs.length) return false;
    return (ev.tags || []).some(function (t) { return state.prefs.indexOf(t) !== -1; });
  }

  function feedScore(ev) {
    // 权重：偏好(0) > 同城(1) > 邻城(2) > 更远(3)；组内按开始时间升序
    var r = rankOf(ev.city);
    var p = matchPref(ev) ? 0 : 1;
    var g = (p * 10) + r;
    var days = Math.max(0, Math.round((toDate(ev.start) - today) / 86400000));
    return g * 1000 + Math.min(days, 999);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    cityLabel: $('cityLabel'), onboard: $('onboard'), feed: $('feed'),
    dateStrip: $('dateStrip'), calTitle: $('calTitle'), calGrid: $('calGrid'),
    calDetail: $('calDetail'), prefChips: $('prefChips'), prefCityGrid: $('prefCityGrid'),
    sheet: $('sheet'), sheetMask: $('sheetMask'), sheetBody: $('sheetBody'),
    cityModal: $('cityModal'), cityMask: $('cityMask'), cityList: $('cityList'),
    prefModal: $('prefModal'), prefMask: $('prefMask'), prefModalChips: $('prefModalChips')
  };

  // ==================== 视图切换 ====================
  function switchView(v) {
    state.view = v;
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('hidden', s.id !== 'view-' + v); });
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    if (v === 'calendar') renderCalendar();
    if (v === 'feed') renderFeed();
    if (v === 'prefs') renderPrefs();
  }

  // ==================== 顶栏 ====================
  function renderCity() { el.cityLabel.textContent = state.city; }
  $('cityBtn').addEventListener('click', openCityModal);
  $('onboardCta').addEventListener('click', openPrefModal);

  // ==================== 信息流 ====================
  function renderDateStrip() {
    if (!state.dateStrip || state.dateStrip === 'today') state.dateStrip = todayStr;
    var strip = el.dateStrip;
    strip.innerHTML = '';
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'date-chip' + (state.dateStrip === 'all' ? ' on' : '');
    all.innerHTML = '<span class="dw">全部</span><span class="dd">ALL</span>';
    all.addEventListener('click', function () { state.dateStrip = 'all'; LS.set('dateStrip', 'all'); renderFeed(); });
    strip.appendChild(all);
    for (var i = 0; i < 14; i++) {
      var d = addDays(today, i);
      var key = fmt(d);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'date-chip' + (state.dateStrip === key ? ' on' : '') + (key === todayStr ? ' today' : '');
      b.innerHTML = '<span class="dw">周' + WEEKS[d.getDay()] + '</span><span class="dd">' + d.getDate() + '</span><span class="dm">' + (d.getMonth() + 1) + '月</span>';
      b.addEventListener('click', (function (k) {
        return function () { state.dateStrip = k; LS.set('dateStrip', k); renderFeed(); };
      })(key));
      strip.appendChild(b);
    }
  }

  function renderFeed() {
    renderDateStrip();
    var list = EVENTS.filter(function (ev) {
      if (state.dateStrip === 'all') return ev.end >= todayStr;
      return ev.start <= state.dateStrip && ev.end >= state.dateStrip;
    });
    // 分组：全部视图按开始日期；选中某天时统一归到该天
    var isAll = state.dateStrip === 'all';
    var groups = {};
    list.forEach(function (ev) {
      var key = isAll ? ev.start : state.dateStrip;
      (groups[key] = groups[key] || []).push(ev);
    });
    var keys = Object.keys(groups).sort();
    if (!keys.length) { el.feed.innerHTML = '<div class="empty-tip">该日期暂无活动，试试"全部"或换个城市</div>'; return; }

    var html = '';
    keys.forEach(function (k) {
      var evs = groups[k].slice().sort(function (a, b) { return feedScore(a) - feedScore(b); });
      var d = toDate(k);
      var isT = k === todayStr;
      var dayLabel = isT ? '今天' : (k === fmt(addDays(today, 1)) ? '明天' : (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEKS[d.getDay()]);
      html += '<div class="day-group"><div class="day-title">' + dayLabel + '<span class="tag">' + evs.length + ' 场</span></div>';
      evs.forEach(function (ev) { html += feedCardHtml(ev); });
      html += '</div>';
    });
    el.feed.innerHTML = html;

    // 绑定事件
    el.feed.querySelectorAll('.feed-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.feed-btn')) return;
        openSheet(card.dataset.id);
      });
    });
    bindAddBtns(el.feed);
  }

  function prettyDate(s) { return parseInt(s.slice(5, 7), 10) + '月' + parseInt(s.slice(8, 10), 10) + '日'; }

  function feedCardHtml(ev) {
    var r = rankOf(ev.city);
    var saved = state.saved.indexOf(ev.id) !== -1;
    var range = ev.start === ev.end
      ? prettyDate(ev.start)
      : prettyDate(ev.start) + ' - ' + prettyDate(ev.end);
    var tag = (ev.tags || []).slice(0, 2).map(function (t) { return '<span class="tile">' + t + '</span>'; }).join('');
    return '<article class="feed-card" data-id="' + ev.id + '">' +
      '<div class="feed-top"><span class="tile rank' + r + '">' + rankLabel(r) + '</span>' + tag + '</div>' +
      '<h3 class="feed-title">' + esc(ev.title) + '</h3>' +
      '<div class="feed-meta"><span><b>' + ev.city + '</b> · ' + esc(ev.venue) + '</span><span>' + range + '</span></div>' +
      '<div class="feed-bottom"><span class="fee">' + esc(ev.fee || '—') + '</span>' +
      '<button class="feed-btn' + (saved ? ' done' : ' add') + '" type="button" data-id="' + ev.id + '">' + (saved ? '已加入' : '加入日历') + '</button>' +
      '</div></article>';
  }

  // ==================== 日历 ====================
  function renderCalendar() {
    var now = state.calYm ? toDate(state.calYm + '-01') : new Date(today.getFullYear(), today.getMonth(), 1);
    if (!state.calYm) state.calYm = fmt(now).slice(0, 7);
    var y = now.getFullYear(), m = now.getMonth();
    el.calTitle.textContent = y + '年' + (m + 1) + '月';

    var first = new Date(y, m, 1);
    var offset = (first.getDay() + 6) % 7; // 周一开头
    var days = new Date(y, m + 1, 0).getDate();
    var html = '';
    for (var i = 0; i < offset; i++) html += '<div class="cal-cell dim"></div>';
    for (var d = 1; d <= days; d++) {
      var key = y + '-' + pad(m + 1) + '-' + pad(d);
      var hasEv = EVENTS.some(function (ev) { return ev.start <= key && ev.end >= key; });
      var cls = ['cal-cell'];
      if (key < todayStr) cls.push('dim');
      if (key === todayStr) cls.push('today');
      if (state.selDate === key) cls.push('selected');
      html += '<div class="' + cls.join(' ') + '" data-date="' + key + '">' + d + (hasEv ? '<span class="dot"></span>' : '') + '</div>';
    }
    el.calGrid.innerHTML = html;
    el.calGrid.querySelectorAll('.cal-cell[data-date]').forEach(function (c) {
      c.addEventListener('click', function () { state.selDate = c.dataset.date; renderCalendar(); });
    });

    renderCalDetail();
  }

  function renderCalDetail() {
    var key = state.selDate || todayStr;
    var evs = EVENTS.filter(function (ev) { return ev.start <= key && ev.end >= key; })
      .slice().sort(function (a, b) { return feedScore(a) - feedScore(b); });
    var d = toDate(key);
    var label = key === todayStr ? '今天' : (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + WEEKS[d.getDay()];
    var html = '<div class="cd-title">' + label + (evs.length ? ' · ' + evs.length + ' 场活动' : '') + '</div>';
    if (!evs.length) html += '<div class="empty-tip">这一天暂时没有收录的活动</div>';
    else evs.forEach(function (ev) { html += feedCardHtml(ev); });
    el.calDetail.innerHTML = html;
    // 重新绑定
    el.calDetail.querySelectorAll('.feed-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.feed-btn')) return;
        openSheet(card.dataset.id);
      });
    });
    bindAddBtns(el.calDetail);
  }

  function bindAddBtns(root) {
    root.querySelectorAll('.feed-btn[data-id]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = b.dataset.id;
        if (b.classList.contains('done')) {
          removeSaved(id);
          b.classList.remove('done'); b.textContent = '加入日历';
          toast('已移出我的日程');
        } else {
          addSaved(id);
          b.classList.add('done'); b.textContent = '已加入';
          toast('已加入我的日程');
        }
      });
    });
  }

  $('calPrev').addEventListener('click', function () {
    var d = toDate(state.calYm + '-01'); d.setMonth(d.getMonth() - 1);
    state.calYm = fmt(d).slice(0, 7); state.selDate = null; renderCalendar();
  });
  $('calNext').addEventListener('click', function () {
    var d = toDate(state.calYm + '-01'); d.setMonth(d.getMonth() + 1);
    state.calYm = fmt(d).slice(0, 7); state.selDate = null; renderCalendar();
  });

  // ==================== 收藏 ====================
  function addSaved(id) {
    if (state.saved.indexOf(id) === -1) state.saved.push(id);
    LS.set('saved', state.saved);
  }
  function removeSaved(id) {
    state.saved = state.saved.filter(function (x) { return x !== id; });
    LS.set('saved', state.saved);
  }

  // ==================== 偏好页 ====================
  function renderPrefs() {
    // chips
    el.prefChips.innerHTML = PREF_CATS.map(function (c) {
      return '<button type="button" class="chip' + (state.prefs.indexOf(c) !== -1 ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    el.prefChips.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () { toggleChip(b, state.prefs); });
    });
    // 城市
    el.prefCityGrid.innerHTML = CITIES.map(function (c) {
      return '<button type="button" class="city-item' + (state.city === c ? ' on' : '') + '" data-city="' + c + '">' + c + '</button>';
    }).join('');
    el.prefCityGrid.querySelectorAll('.city-item').forEach(function (b) {
      b.addEventListener('click', function () {
        state.city = b.dataset.city; LS.set('city', state.city); renderCity(); renderPrefs(); renderFeed();
      });
    });
  }
  $('savePrefs').addEventListener('click', function () { saveAndToast(); });

  function toggleChip(b, arr) {
    var v = b.dataset.cat;
    var i = arr.indexOf(v);
    if (i === -1) arr.push(v); else arr.splice(i, 1);
    b.classList.toggle('on');
  }

  function saveAndToast() {
    LS.set('prefs', state.prefs);
    LS.set('onbDone', true);
    state.onbDone = true;
    el.onboard.classList.add('hidden');
    toast('偏好已保存，推送已更新');
    switchView('feed');
  }

  // ==================== 城市弹窗 ====================
  function openCityModal() {
    el.cityList.innerHTML = CITIES.map(function (c) {
      return '<button type="button" class="city-opt' + (state.city === c ? ' on' : '') + '" data-city="' + c + '">' + c + '</button>';
    }).join('');
    el.cityList.querySelectorAll('.city-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        state.city = b.dataset.city; LS.set('city', state.city); renderCity(); renderFeed();
        closeCityModal();
        toast('已切换至 ' + state.city);
      });
    });
    el.cityModal.classList.remove('hidden'); el.cityMask.classList.remove('hidden');
  }
  function closeCityModal() { el.cityModal.classList.add('hidden'); el.cityMask.classList.add('hidden'); }
  $('cityClose').addEventListener('click', closeCityModal);
  el.cityMask.addEventListener('click', closeCityModal);

  // ==================== 偏好弹窗 ====================
  function openPrefModal() {
    el.prefModalChips.innerHTML = PREF_CATS.map(function (c) {
      return '<button type="button" class="chip' + (state.prefs.indexOf(c) !== -1 ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    el.prefModalChips.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () { toggleChip(b, state.prefs); });
    });
    el.prefModal.classList.remove('hidden'); el.prefMask.classList.remove('hidden');
  }
  function closePrefModal() { el.prefModal.classList.add('hidden'); el.prefMask.classList.add('hidden'); }
  $('prefModalClose').addEventListener('click', function () { saveAndToast(); closePrefModal(); });
  el.prefMask.addEventListener('click', closePrefModal);

  // ==================== 活动详情抽屉 ====================
  function openSheet(id) {
    var ev = EVENTS.find(function (x) { return x.id === id; });
    if (!ev) return;
    state.selEv = ev;
    var r = rankOf(ev.city);
    var range = ev.start === ev.end
      ? prettyDate(ev.start)
      : prettyDate(ev.start) + ' — ' + prettyDate(ev.end);
    var tags = (ev.tags || []).map(function (t) { return '<span class="tile">' + t + '</span>'; }).join('');
    el.sheetBody.innerHTML =
      '<div class="feed-top">' +
      '<span class="tile rank' + r + '">' + rankLabel(r) + '</span>' + tags + '</div>' +
      '<h3 class="sheet-title">' + esc(ev.title) + '</h3>' +
      '<div class="sheet-section">' +
      '<div class="row"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span><b>' + range + '</b></span></div>' +
      '<div class="row"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span><b>' + ev.city + '</b> · ' + esc(ev.venue) + '</span></div>' +
      '<div class="row"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 7l-5-5-5 5"/></svg><span><b>' + esc(ev.fee || '—') + '</b></span></div>' +
      '</div>' +
      '<p class="sheet-desc">' + esc(ev.desc || '') + '</p>' +
      '<div class="sheet-src">来源：' + esc(ev.source || '公开报道') + ' · 以官方最新发布为准</div>' +
      '<div class="sheet-actions">' +
      '<button class="sheet-btn primary" id="icsBtn" type="button">导入手机日历</button>' +
      '<button class="sheet-btn alt" id="copyBtn" type="button">复制信息</button>' +
      '</div>' +
      '<div class="sheet-toast" id="sheetToast"></div>';

    el.sheet.classList.remove('hidden'); el.sheetMask.classList.remove('hidden');
    $('icsBtn').addEventListener('click', function () { downloadICS(ev); });
    $('copyBtn').addEventListener('click', function () {
      var text = '【' + ev.title + '】\n时间：' + range + '\n地点：' + ev.city + ' ' + ev.venue + '\n' + (ev.desc || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { sheetToast('已复制，可粘贴到任意日历/聊天'); });
      } else {
        var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); sheetToast('已复制，可粘贴到任意日历/聊天');
      }
    });
  }
  function sheetToast(msg) { var t = $('sheetToast'); t.textContent = msg; setTimeout(function () { t.textContent = ''; }, 2000); }
  function closeSheet() { el.sheet.classList.add('hidden'); el.sheetMask.classList.add('hidden'); }
  el.sheetMask.addEventListener('click', closeSheet);

  // ==================== 生成 .ics 文件 ====================
  function toIcsDate(s) { return s.replace(/-/g, ''); }

  function downloadICS(ev) {
    var start = toIcsDate(ev.start);
    var end = addDays(toDate(ev.end), 1);
    var endStr = toIcsDate(fmt(end));
    var uid = 'sbyz-' + ev.id + '@shenbianyouzhan.demo';
    var nowStamp = (function () { var d = new Date(); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; })();
    var summary = ev.title;
    var location = ev.city + ' ' + ev.venue;
    var desc = (ev.desc || '') + ' (来源：' + (ev.source || '公开报道') + ')';

    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ShenBianYouZhan//CN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + nowStamp,
      'DTSTART;VALUE=DATE:' + start,
      'DTEND;VALUE=DATE:' + endStr,
      'SUMMARY:' + summary,
      'LOCATION:' + location,
      'DESCRIPTION:' + desc,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (ev.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 30)) + '.ics';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
    sheetToast('日历文件已下载，打开后导入手机日历即可');
  }

  // ==================== Toast ====================
  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector('.global-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'global-toast';
      document.body.appendChild(t);
      var st = document.createElement('style');
      st.textContent = '.global-toast{position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(35,32,28,.92);color:#fff;font-size:13px;padding:10px 18px;border-radius:999px;z-index:99;opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center}';
      document.head.appendChild(st);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 1800);
  }

  // ==================== Tab 切换 ====================
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { switchView(b.dataset.view); });
  });

  // ==================== 初始化 ====================
  function init() {
    renderCity();
    if (state.onbDone || state.prefs.length) { el.onboard.classList.add('hidden'); }
    else { el.onboard.classList.remove('hidden'); }
    switchView('feed');
  }
  init();
})();
