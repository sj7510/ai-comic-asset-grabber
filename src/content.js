/**
 * AssetGrab content script.
 * Scans the asset cards rendered by the platform, shows a floating side panel,
 * lets the user multi-select assets and download them into a named folder.
 *
 * Selectors are intentionally kept in SITE below so the adapter is easy to update.
 */
(function () {
  'use strict';

  if (window.__ASSET_GRABBER_LOADED__) return;
  window.__ASSET_GRABBER_LOADED__ = true;

  var LIB = globalThis.AssetLib;
  if (!LIB) {
    console.warn('[AssetGrab] shared lib missing');
    return;
  }

  var SITE = {
    card: 'article.asset-card',
    media: '.media-slot img',
    image: 'img',
    name: ':scope > strong'
  };

  var HOST_ID = 'asset-grabber-host';
  var SETTINGS_KEY = 'assetgrab:settings';
  var CLOSED_KEY = 'assetgrab:closed';

  var state = {
    initialized: false,
    open: false,
    collapsed: false,
    host: null,
    shadow: null,
    panel: null,
    rail: null,
    listEl: null,
    assets: [],
    visibleKeys: [],
    selected: new Set(),
    query: '',
    typeFilter: 'all',
    lastClickedIndex: -1,
    hoverRow: null,
    downloading: false,
    cancelRequested: false,
    autoOpenTried: false,
    scanStats: { cards: 0, withImage: 0, roots: 1, frames: 0, shadows: 0 },
    settings: { folder: '', pattern: 'name', autoOpen: true, pos: null }
  };

  var toastTimer = 0;
  var syncTimer = 0;
  var progressHideTimer = 0;
  var lastScanLog = '';
  var dragState = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function truncate(text, max) {
    var s = String(text || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function safeSessionRemove(key) {
    try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function selectedAssets() {
    return state.assets.filter(function (asset) {
      return !asset.missing && state.selected.has(asset.key);
    });
  }

  function findAsset(key) {
    for (var i = 0; i < state.assets.length; i++) {
      if (state.assets[i].key === key) return state.assets[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function loadSettings() {
    return LIB.storage.get(SETTINGS_KEY).then(function (res) {
      var saved = res && res[SETTINGS_KEY];
      if (saved && typeof saved === 'object') {
        if (typeof saved.folder === 'string') state.settings.folder = saved.folder;
        if (typeof saved.autoOpen === 'boolean') state.settings.autoOpen = saved.autoOpen;
        if (saved.pos && typeof saved.pos === 'object' &&
            isFinite(saved.pos.left) && isFinite(saved.pos.top)) {
          state.settings.pos = {
            left: Number(saved.pos.left),
            top: Number(saved.pos.top),
            width: isFinite(saved.pos.width) ? Number(saved.pos.width) : 392,
            height: isFinite(saved.pos.height) ? Number(saved.pos.height) : 0
          };
        }
      }
      state.settings.pattern = 'name';
    }).catch(function () { /* storage may be unavailable */ });
  }

  function saveSettings() {
    var payload = {};
    payload[SETTINGS_KEY] = state.settings;
    LIB.storage.set(payload).catch(function () { /* ignore */ });
  }

  /* ------------------------------------------------------------------ */
  /* UI construction                                                     */
  /* ------------------------------------------------------------------ */

  var CSS = [
    '*,*::before,*::after{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    'button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}',
    'input,select{font:inherit;color:inherit}',
    '.shell{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
    'font-size:13px;line-height:1.45;color:#e9ebf3;-webkit-font-smoothing:antialiased}',
    '.panel{height:100%;display:flex;flex-direction:column;position:relative;pointer-events:auto;overflow:hidden;',
    'background:linear-gradient(180deg,rgba(25,27,39,.97) 0%,rgba(14,15,23,.985) 100%);',
    'border:1px solid rgba(255,255,255,.09);border-radius:16px;',
    'box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.25);',
    'backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}',
    '.panel::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;',
    'background:linear-gradient(90deg,transparent,rgba(167,139,250,.75),transparent);pointer-events:none}',
    /* header */
    '.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 10px;flex:none;',
    'cursor:move;user-select:none;-webkit-user-select:none;touch-action:none}',
    '.brand{display:flex;align-items:center;gap:10px;min-width:0}',
    '.brand-icon{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:15px;color:#fff;flex:none;',
    'background:linear-gradient(135deg,#8b5cf6,#4f46e5);box-shadow:0 6px 16px rgba(109,74,255,.35)}',
    '.brand-text{display:flex;flex-direction:column;min-width:0;gap:1px}',
    '.brand-text b{font-size:14px;font-weight:650;letter-spacing:.2px}',
    '.brand-text span{font-size:11px;color:#8f95ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.head-actions{display:flex;align-items:center;gap:2px;flex:none}',
    '.icon-btn{width:27px;height:27px;border-radius:7px;display:grid;place-items:center;color:#9aa0b6;font-size:15px;',
    'line-height:1;transition:background .15s,color .15s}',
    '.icon-btn:hover{background:rgba(255,255,255,.08);color:#fff}',
    /* toolbar */
    '.toolbar{display:flex;align-items:center;gap:6px;padding:0 12px 8px;flex:none}',
    '.search{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;',
    'background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);border-radius:9px;transition:border-color .15s}',
    '.search:focus-within{border-color:rgba(139,92,246,.6)}',
    '.search-icon{color:#7c8299;font-size:14px;flex:none}',
    '.search input{flex:1;min-width:0;background:transparent;border:0;outline:0;font-size:12.5px;color:#e9ebf3}',
    '.search input::placeholder{color:#6f7590}',
    '.btn{border-radius:9px;font-size:12.5px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;',
    'gap:6px;transition:background .15s,border-color .15s,opacity .15s,transform .06s;white-space:nowrap}',
    '.btn.sm{height:30px;padding:0 10px}',
    '.btn.ghost{border:1px solid rgba(255,255,255,.1);color:#b9bfd4;background:rgba(255,255,255,.02)}',
    '.btn.ghost:hover{background:rgba(255,255,255,.07);color:#fff}',
    '.btn.primary{height:34px;padding:0 18px;color:#fff;background:linear-gradient(135deg,#8b5cf6,#5b5bf0);',
    'box-shadow:0 6px 18px rgba(91,91,240,.3)}',
    '.btn.primary:hover{filter:brightness(1.08)}',
    '.btn.primary:active{transform:translateY(1px)}',
    '.btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;filter:none}',
    /* chips */
    '.chips{display:flex;gap:6px;padding:0 12px 9px;overflow-x:auto;flex:none;scrollbar-width:none}',
    '.chips::-webkit-scrollbar{display:none}',
    '.chip{height:24px;padding:0 9px;border-radius:12px;font-size:11.5px;color:#9aa0b6;flex:none;',
    'border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);transition:all .15s}',
    '.chip:hover{color:#d9dce8;background:rgba(255,255,255,.06)}',
    '.chip.active{color:#ede9fe;border-color:rgba(139,92,246,.55);background:rgba(139,92,246,.18)}',
    '.chip em{font-style:normal;opacity:.65;margin-left:4px;font-size:10.5px}',
    /* list */
    '.list-wrap{flex:1;min-height:0;position:relative}',
    '.list{height:100%;overflow-y:auto;overflow-x:hidden;padding:2px 8px 10px;scrollbar-width:thin;',
    'scrollbar-color:rgba(255,255,255,.14) transparent;overscroll-behavior:contain}',
    '.list::-webkit-scrollbar{width:8px}',
    '.list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border-radius:8px}',
    '.list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.22)}',
    '.row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:10px;cursor:pointer;position:relative;',
    'border:1px solid transparent;transition:background .12s,border-color .12s;content-visibility:auto;contain-intrinsic-size:62px;',
    'user-select:none;-webkit-user-select:none}',
    '.row:hover{background:rgba(255,255,255,.055)}',
    '.row.selected{background:rgba(139,92,246,.13);border-color:rgba(139,92,246,.22)}',
    '.row:focus-visible{outline:1px solid rgba(167,139,250,.7);outline-offset:-1px}',
    '.check{width:18px;height:18px;border-radius:6px;border:1.5px solid rgba(255,255,255,.22);flex:none;',
    'display:grid;place-items:center;transition:all .12s;background:rgba(0,0,0,.15)}',
    '.row.selected .check{background:linear-gradient(135deg,#8b5cf6,#6366f1);border-color:transparent}',
    '.check::after{content:"";width:8px;height:4px;border-left:2px solid #fff;border-bottom:2px solid #fff;',
    'transform:rotate(-45deg) translateY(-1px);opacity:0;transition:opacity .12s}',
    '.row.selected .check::after{opacity:1}',
    '.thumb{width:46px;height:46px;border-radius:8px;object-fit:cover;background:linear-gradient(135deg,#2a2d3c,#1c1e29);',
    'flex:none;display:block;border:1px solid rgba(255,255,255,.06)}',
    '.thumb.broken{opacity:.3}',
    '.thumb-placeholder{width:46px;height:46px;border-radius:8px;flex:none;display:grid;place-items:center;font-size:11px;',
    'color:#6f7590;background:linear-gradient(135deg,#232634,#181a26);border:1px dashed rgba(255,255,255,.12)}',
    '.row.missing{opacity:.72}',
    '.row.missing .check{border-style:dashed}',
    '.meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.name{font-size:12.5px;font-weight:550;color:#e6e8f1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sub{display:flex;align-items:center;gap:6px;min-width:0}',
    '.tag{font-size:10px;padding:1px 5px;border-radius:4px;color:#c4b5fd;background:rgba(139,92,246,.16);flex:none}',
    '.dim{font-size:10px;color:#71778f;white-space:nowrap}',
    '.dim.warn{color:#f0a35e}',
    /* empty */
    '.empty{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:6px;padding:24px;text-align:center;pointer-events:none}',
    '.empty-icon{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-size:20px;color:#6d5bd0;',
    'background:rgba(139,92,246,.1);border:1px dashed rgba(139,92,246,.35);margin-bottom:4px}',
    '.empty-title{font-size:13px;font-weight:600;color:#b9bfd4}',
    '.empty-sub{font-size:11.5px;color:#6f7590;max-width:230px;line-height:1.6}',
    /* footer */
    '.foot{flex:none;border-top:1px solid rgba(255,255,255,.07);padding:10px 12px 11px;background:rgba(0,0,0,.16)}',
    '.foot-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.count{font-size:12px;color:#8f95ab;white-space:nowrap}',
    '.count b{color:#c4b5fd;font-weight:650;font-size:13px}',
    '.count i{font-style:normal;color:#c3c8d8}',
    '.foot-actions{display:flex;align-items:center;gap:6px}',
    '.progress{margin-top:9px;display:flex;flex-direction:column;gap:5px}',
    '.bar{height:3px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}',
    '.bar i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#8b5cf6,#6366f1);',
    'transition:width .2s ease}',
    '.progress-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#8f95ab}',
    '.progress-meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.link-btn{font-size:11px;color:#a78bfa;flex:none;padding:2px 0}',
    '.link-btn:hover{color:#c4b5fd}',
    /* modal */
    '.modal{position:absolute;top:0;right:0;bottom:0;left:0;z-index:20;display:grid;place-items:center;padding:16px;',
    'background:rgba(6,7,12,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:16px}',
    '.modal-card{width:100%;max-width:330px;background:#1a1c28;border:1px solid rgba(255,255,255,.1);border-radius:14px;',
    'padding:16px;box-shadow:0 24px 60px rgba(0,0,0,.5);animation:pop .16s ease-out}',
    '@keyframes pop{from{opacity:0;transform:scale(.97) translateY(4px)}to{opacity:1;transform:none}}',
    '.modal-card h3{margin:0 0 4px;font-size:14px;font-weight:650;color:#f1f2f8}',
    '.modal-sub{margin:0 0 14px;font-size:11.5px;color:#838aa2;line-height:1.5}',
    '.modal-sub b{color:#c4b5fd}',
    '.field{display:flex;flex-direction:column;gap:6px;margin-bottom:11px}',
    '.field>span{font-size:11.5px;color:#9aa0b6}',
    '.field input,.field select{height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.11);',
    'background:rgba(255,255,255,.05);padding:0 10px;font-size:12.5px;outline:0;width:100%}',
    '.field input:focus,.field select:focus{border-color:rgba(139,92,246,.65);background:rgba(139,92,246,.08);',
    'box-shadow:0 0 0 3px rgba(139,92,246,.14)}',
    '.field select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,#8f95ab 50%),',
    'linear-gradient(135deg,#8f95ab 50%,transparent 50%);background-position:calc(100% - 15px) 15px,calc(100% - 10px) 15px;',
    'background-size:5px 5px;background-repeat:no-repeat;padding-right:28px}',
    '.path-preview{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;',
    'background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.05);margin-bottom:14px}',
    '.path-preview span{font-size:10.5px;color:#6f7590}',
    '.path-preview code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:#a5abbe;',
    'word-break:break-all;line-height:1.45;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.modal-actions{display:flex;justify-content:flex-end;gap:8px}',
    '.modal-actions .btn.ghost{height:32px;padding:0 14px}',
    /* toast */
    '.toast{position:absolute;left:14px;right:14px;bottom:76px;z-index:30;padding:9px 12px;border-radius:9px;',
    'background:rgba(32,35,48,.98);border:1px solid rgba(255,255,255,.1);font-size:11.5px;color:#d6dae7;',
    'text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.4);line-height:1.5}',
    '.toast.error{border-color:rgba(229,72,77,.45);color:#ffb4b6}',
    /* rail */
    '.rail{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 9px;',
    'border-radius:13px 0 0 13px;background:linear-gradient(180deg,rgba(30,32,46,.98),rgba(18,19,29,.98));',
    'border:1px solid rgba(255,255,255,.1);border-right:0;cursor:pointer;',
    'box-shadow:0 14px 36px rgba(0,0,0,.45);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.rail:hover{border-color:rgba(139,92,246,.5)}',
    '.rail-dot{width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#6366f1);',
    'box-shadow:0 0 10px rgba(139,92,246,.9)}',
    '.rail-text{font-size:11px;color:#c3c8d8;writing-mode:vertical-rl;letter-spacing:2px}',
    '.rail-count{font-size:11px;font-weight:650;color:#fff;background:rgba(139,92,246,.35);border-radius:8px;',
    'padding:1px 5px;min-width:20px;text-align:center}'
  ].join('');

  var HTML = [
    '<div class="shell">',
    '  <div class="rail" id="rail" hidden>',
    '    <span class="rail-dot"></span>',
    '    <span class="rail-text">素材抓取</span>',
    '    <span class="rail-count" id="rail-count">0</span>',
    '  </div>',
    '  <section class="panel" id="panel" hidden>',
    '    <header class="head" title="按住标题栏拖动面板，双击复位">',
    '      <div class="brand">',
    '        <div class="brand-icon">◈</div>',
    '        <div class="brand-text"><b>素材抓取</b><span id="subtitle">正在读取页面…</span></div>',
    '      </div>',
    '      <div class="head-actions">',
    '        <button class="icon-btn" data-action="rescan" title="重新扫描">↻</button>',
    '        <button class="icon-btn" data-action="collapse" title="收起">–</button>',
    '        <button class="icon-btn" data-action="close" title="关闭">×</button>',
    '      </div>',
    '    </header>',
    '    <div class="toolbar">',
    '      <div class="search"><span class="search-icon">⌕</span>',
    '        <input id="search" type="search" placeholder="搜索名称…" autocomplete="off" spellcheck="false">',
    '      </div>',
    '      <button class="btn ghost sm" data-action="select-all" id="select-all-btn">全选</button>',
    '      <button class="btn ghost sm" data-action="invert">反选</button>',
    '    </div>',
    '    <div class="chips" id="chips"></div>',
    '    <div class="list-wrap">',
    '      <div class="list" id="list"></div>',
    '      <div class="empty" id="empty" hidden>',
    '        <div class="empty-icon">▣</div>',
    '        <p class="empty-title" id="empty-title">还没有发现素材</p>',
    '        <p class="empty-sub" id="empty-sub">等待页面加载完成，或点右上角 ↻ 重新扫描</p>',
    '      </div>',
    '    </div>',
    '    <footer class="foot">',
    '      <div class="foot-row">',
    '        <div class="count"><b id="count-selected">0</b><span> / <i id="count-total">0</i> 个</span></div>',
    '        <div class="foot-actions">',
    '          <button class="btn ghost sm" data-action="clear">清空</button>',
    '          <button class="btn primary" data-action="download" id="download-btn">下载</button>',
    '        </div>',
    '      </div>',
    '      <div class="progress" id="progress" hidden>',
    '        <div class="bar"><i id="bar-fill"></i></div>',
    '        <div class="progress-meta"><span id="progress-text">准备中…</span>',
    '          <button class="link-btn" data-action="cancel">取消</button>',
    '        </div>',
    '      </div>',
    '    </footer>',
    '    <div class="modal" id="modal" hidden>',
    '      <div class="modal-card">',
    '        <h3>下载所选素材</h3>',
    '        <p class="modal-sub">共 <b id="modal-count">0</b> 个文件，将保存到浏览器下载目录</p>',
    '        <label class="field"><span>文件夹名称</span>',
    '          <input id="folder-input" maxlength="60" spellcheck="false" autocomplete="off">',
    '        </label>',
    '        <div class="path-preview"><span>保存为</span><code id="path-preview"></code></div>',
    '        <div class="modal-actions">',
    '          <button class="btn ghost" data-action="modal-cancel">取消</button>',
    '          <button class="btn primary" data-action="modal-confirm">开始下载</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div class="toast" id="toast" hidden></div>',
    '  </section>',
    '</div>'
  ].join('\n');

  function createUI() {
    if (state.host) return;

    var host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-asset-grabber', '1');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'z-index: 2147483646',
      'top: 16px',
      'right: 16px',
      'bottom: 16px',
      'width: 392px',
      'max-width: calc(100vw - 24px)',
      'display: none',
      'pointer-events: none'
    ].join(';');

    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;

    (document.documentElement || document.body).appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.panel = shadow.getElementById('panel');
    state.rail = shadow.getElementById('rail');

    bindEvents();
    renderChips();
    render();
  }

  function bindEvents() {
    var shadow = state.shadow;

    shadow.addEventListener('click', function (event) {
      var modal = shadow.getElementById('modal');
      if (!modal.hidden && event.target === modal) {
        closeModal();
        return;
      }

      var actionEl = event.target.closest ? event.target.closest('[data-action]') : null;
      if (actionEl) {
        handleAction(actionEl.getAttribute('data-action'), event);
        return;
      }

      var chip = event.target.closest ? event.target.closest('.chip') : null;
      if (chip) {
        state.typeFilter = chip.getAttribute('data-type');
        state.lastClickedIndex = -1;
        render();
        return;
      }

      var row = event.target.closest ? event.target.closest('.row') : null;
      if (row) {
        toggleRow(row.getAttribute('data-key'), event.shiftKey);
      }
    });

    shadow.addEventListener('input', function (event) {
      if (event.target.id === 'search') {
        state.query = event.target.value;
        state.lastClickedIndex = -1;
        render();
      } else if (event.target.id === 'folder-input') {
        updatePreview();
      }
    });

    shadow.addEventListener('keydown', function (event) {
      var modal = shadow.getElementById('modal');
      if (event.key === 'Escape') {
        if (!modal.hidden) {
          closeModal();
          event.stopPropagation();
        }
        return;
      }
      if (event.target.id === 'folder-input' && event.key === 'Enter') {
        confirmDownload();
        event.preventDefault();
        return;
      }
      var row = event.target.closest ? event.target.closest('.row') : null;
      if (row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        toggleRow(row.getAttribute('data-key'), event.shiftKey);
      }
    });

    shadow.addEventListener('mouseover', function (event) {
      var row = event.target.closest ? event.target.closest('.row') : null;
      if (!row || row === state.hoverRow) return;
      clearHover();
      state.hoverRow = row;
      var asset = findAsset(row.getAttribute('data-key'));
      if (asset) highlight(asset, true);
    });

    shadow.addEventListener('mouseout', function (event) {
      var row = event.target.closest ? event.target.closest('.row') : null;
      if (!row || row !== state.hoverRow) return;
      if (event.relatedTarget && row.contains(event.relatedTarget)) return;
      clearHover();
    });

    shadow.addEventListener('error', function (event) {
      var img = event.target;
      if (img && img.classList && img.classList.contains('thumb')) {
        img.classList.add('broken');
      }
    }, true);

    var rail = shadow.getElementById('rail');
    rail.addEventListener('click', function () { showPanel(); });

    var head = shadow.querySelector('.head');
    if (head) {
      head.addEventListener('pointerdown', onHeaderPointerDown);
      head.addEventListener('pointermove', onHeaderPointerMove);
      head.addEventListener('pointerup', finishDrag);
      head.addEventListener('pointercancel', finishDrag);
      head.addEventListener('dblclick', function (event) {
        if (event.target.closest && event.target.closest('button')) return;
        resetPanelPosition();
      });
    }

    window.addEventListener('resize', function () {
      if (state.open) applyPanelPosition();
    });
  }

  function handleAction(action, event) {
    switch (action) {
      case 'rescan':
        syncAssets();
        toast('已重新扫描，共 ' + state.assets.length + ' 个素材');
        break;
      case 'collapse':
        collapsePanel();
        break;
      case 'close':
        closePanel();
        break;
      case 'select-all':
        toggleSelectAll();
        break;
      case 'invert':
        invertSelection();
        break;
      case 'clear':
        state.selected.clear();
        state.lastClickedIndex = -1;
        updateSelectionUI();
        break;
      case 'download':
        openModal();
        break;
      case 'cancel':
        if (state.downloading) {
          state.cancelRequested = true;
          setProgressText('正在取消…');
        }
        break;
      case 'modal-cancel':
        closeModal();
        break;
      case 'modal-confirm':
        confirmDownload();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Panel visibility                                                    */
  /* ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function panelWidth() {
    return Math.min(392, Math.max(280, window.innerWidth - 24));
  }

  function applyPanelPosition() {
    var host = state.host;
    if (!host) return;
    var width = panelWidth();
    var maxHeight = Math.max(240, window.innerHeight - 16);
    var pos = state.settings.pos;

    if (pos) {
      var height = Math.min(pos.height || (window.innerHeight - 32), maxHeight);
      var left = clamp(pos.left, 8, Math.max(8, window.innerWidth - width - 8));
      var top = clamp(pos.top, 8, Math.max(8, window.innerHeight - height - 8));
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.width = width + 'px';
      host.style.height = height + 'px';
    } else {
      host.style.left = 'auto';
      host.style.right = '16px';
      host.style.top = '16px';
      host.style.bottom = '16px';
      host.style.width = width + 'px';
      host.style.height = 'auto';
    }
    host.style.transform = 'none';
  }

  function showPanel() {
    if (!state.host) return;
    state.open = true;
    state.collapsed = false;
    state.host.style.display = 'block';
    applyPanelPosition();
    state.panel.hidden = false;
    state.rail.hidden = true;
    safeSessionRemove(CLOSED_KEY);
    syncAssets();
    updateRail();
  }

  function closePanel() {
    if (!state.host) return;
    clearHover();
    state.open = false;
    state.collapsed = false;
    state.host.style.display = 'none';
    state.panel.hidden = true;
    state.rail.hidden = true;
    safeSessionSet(CLOSED_KEY, '1');
  }

  function collapsePanel() {
    if (!state.host) return;
    state.open = false;
    state.collapsed = true;
    state.host.style.display = 'block';
    state.host.style.left = 'auto';
    state.host.style.right = '16px';
    state.host.style.top = '50%';
    state.host.style.bottom = 'auto';
    state.host.style.width = 'auto';
    state.host.style.height = 'auto';
    state.host.style.transform = 'translateY(-50%)';
    state.panel.hidden = true;
    state.rail.hidden = false;
    updateRail();
  }

  function togglePanel() {
    if (!state.host) return;
    if (state.open) closePanel();
    else if (state.collapsed) showPanel();
    else showPanel();
  }

  function onHeaderPointerDown(event) {
    if (!state.host || state.collapsed) return;
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest('button')) return;

    var rect = state.host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };

    state.host.style.left = rect.left + 'px';
    state.host.style.top = rect.top + 'px';
    state.host.style.right = 'auto';
    state.host.style.bottom = 'auto';
    state.host.style.width = rect.width + 'px';
    state.host.style.height = rect.height + 'px';
    state.host.style.transform = 'none';

    try {
      var head = event.currentTarget;
      if (head.setPointerCapture) head.setPointerCapture(event.pointerId);
    } catch (e) { /* synthetic pointer events */ }
    event.preventDefault();
  }

  function onHeaderPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    var maxLeft = Math.max(0, window.innerWidth - dragState.width);
    var maxTop = Math.max(0, window.innerHeight - 140);
    var left = clamp(dragState.left + (event.clientX - dragState.startX), 0, maxLeft);
    var top = clamp(dragState.top + (event.clientY - dragState.startY), 0, maxTop);
    // Shrink (and regrow) the height so the footer stays visible while dragging down.
    var height = Math.max(120, Math.min(dragState.height, window.innerHeight - top - 8));
    state.host.style.left = left + 'px';
    state.host.style.top = top + 'px';
    state.host.style.height = height + 'px';
    event.preventDefault();
  }

  function finishDrag(event) {
    if (!dragState) return;
    if (event && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) return;
    var rect = state.host.getBoundingClientRect();
    state.settings.pos = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    saveSettings();
    dragState = null;
  }

  function resetPanelPosition() {
    state.settings.pos = null;
    saveSettings();
    applyPanelPosition();
  }

  function updateRail() {
    if (!state.shadow) return;
    var countEl = state.shadow.getElementById('rail-count');
    if (countEl) countEl.textContent = String(state.assets.length);
  }

  /* ------------------------------------------------------------------ */
  /* Scanning                                                            */
  /* ------------------------------------------------------------------ */

  function collectRoots() {
    var roots = [];
    var seen = typeof Set !== 'undefined' ? new Set() : null;
    function add(root) {
      if (!root) return;
      if (seen) {
        if (seen.has(root)) return;
        seen.add(root);
      }
      roots.push(root);
    }

    add(document);

    var frames = [];
    try { frames = document.querySelectorAll('iframe'); } catch (e) { frames = []; }
    var frameCount = frames.length;
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].contentDocument;
        if (doc && doc.documentElement) add(doc);
      } catch (e) { /* cross-origin iframe: can't read, will be reflected in stats */ }
    }

    var shadowCount = 0;
    function addShadows(root) {
      if (shadowCount > 120) return;
      var all;
      try { all = root.querySelectorAll('*'); } catch (e) { return; }
      for (var j = 0; j < all.length && shadowCount <= 120; j++) {
        var sr = all[j].shadowRoot;
        if (sr) {
          shadowCount++;
          add(sr);
          addShadows(sr);
        }
      }
    }
    for (var k = 0; k < roots.length; k++) addShadows(roots[k]);

    return { roots: roots, frames: frameCount, shadows: shadowCount };
  }

  function scanPage() {
    var collected = collectRoots();
    var stats = {
      cards: 0,
      withImage: 0,
      roots: collected.roots.length,
      frames: collected.frames,
      shadows: collected.shadows
    };
    var out = [];
    var seen = Object.create(null);

    for (var r = 0; r < collected.roots.length; r++) {
      var root = collected.roots[r];
      var cards;
      try { cards = root.querySelectorAll(SITE.card); } catch (e) { continue; }

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        stats.cards++;

        var key = (card.getAttribute('data-asset') || card.getAttribute('data-key') || '').trim();
        var img = null;
        if (SITE.media) img = card.querySelector(SITE.media);
        if (!img) img = card.querySelector(SITE.image);

        var src = img
          ? (img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') ||
             img.getAttribute('data-original') || '')
          : '';

        var parsed = key
          ? LIB.parseAssetKey(key)
          : { key: '', type: 'other', typeLabel: '素材', name: '' };
        var nameEl = card.querySelector(SITE.name) || card.querySelector('strong');
        var nameText = nameEl ? (nameEl.textContent || '').trim() : '';
        var altText = img && img.getAttribute('alt') ? img.getAttribute('alt').trim() : '';
        var name = nameText || altText || parsed.name || ('素材 ' + stats.cards);

        if (!key) key = 'auto:' + name + ':' + stats.cards;
        if (seen[key]) continue;
        seen[key] = true;

        // Only list assets that actually have an image (skip "未生图" cards).
        if (!src) continue;
        stats.withImage++;

        out.push({
          key: key,
          type: parsed.type,
          typeLabel: parsed.typeLabel,
          name: name,
          src: src,
          el: card,
          imgEl: img,
          w: (img && img.naturalWidth) || 0,
          h: (img && img.naturalHeight) || 0,
          stale: false,
          missing: false
        });

        if (img && !img.__assetGrabHooked) {
          img.__assetGrabHooked = true;
          if (!img.complete) {
            img.addEventListener('load', function () { scheduleSync(250); }, { once: true });
          }
        }
      }
    }

    state.scanStats = stats;
    return out;
  }

  function syncAssets() {
    var fresh = scanPage();
    var oldByKey = Object.create(null);

    state.assets.forEach(function (asset) { oldByKey[asset.key] = asset; });

    var next = fresh.map(function (asset) {
      var old = oldByKey[asset.key];
      if (!old) return asset;
      old.name = asset.name;
      old.src = asset.src;
      old.el = asset.el;
      old.imgEl = asset.imgEl;
      old.missing = asset.missing;
      if (asset.w) old.w = asset.w;
      if (asset.h) old.h = asset.h;
      old.stale = false;
      return old;
    });

    // Only keep what is currently rendered on the page. Off-screen / removed
    // cards are dropped, together with their selection.
    state.assets = next;
    var present = Object.create(null);
    next.forEach(function (asset) { present[asset.key] = true; });
    Array.from(state.selected).forEach(function (key) {
      if (!present[key]) state.selected.delete(key);
    });

    state.visibleKeys = getVisibleAssets().map(function (asset) { return asset.key; });
    render();
    updateRail();

    var stats = state.scanStats || {};
    var sig = stats.cards + '/' + stats.withImage + '/' + stats.roots + '/' + stats.frames + '/' + stats.shadows + ':' + fresh.length;
    if (sig !== lastScanLog) {
      lastScanLog = sig;
      try { console.info('[AssetGrab] 扫描结果', stats, '素材', fresh.length); } catch (e) { /* ignore */ }
    }

    if (!state.open && state.assets.length && !state.autoOpenTried) {
      state.autoOpenTried = true;
      maybeAutoOpen();
    }
  }

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = 0;
      syncAssets();
    }, delay || 450);
  }

  function observePage() {
    var observer = new MutationObserver(function (mutations) {
      var relevant = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (state.host && mutation.target === state.host) continue;
        if (mutation.type === 'attributes') {
          relevant = true;
          break;
        }
        if (mutation.removedNodes && mutation.removedNodes.length) {
          relevant = true;
          break;
        }
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node === state.host) continue;
          if (node.nodeType === 1 || node.nodeType === 3) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant) scheduleSync(450);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-asset']
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function getVisibleAssets() {
    var query = state.query.trim().toLowerCase();
    return state.assets.filter(function (asset) {
      if (state.typeFilter !== 'all' && asset.type !== state.typeFilter) return false;
      if (query && asset.name.toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
  }

  function renderChips() {
    var chipsEl = state.shadow && state.shadow.getElementById('chips');
    if (!chipsEl) return;

    var counts = Object.create(null);
    state.assets.forEach(function (asset) {
      counts[asset.type] = counts[asset.type] || { label: asset.typeLabel, count: 0 };
      counts[asset.type].count++;
    });

    var html = '<button class="chip' + (state.typeFilter === 'all' ? ' active' : '') +
      '" data-type="all">全部<em>' + state.assets.length + '</em></button>';

    Object.keys(counts).forEach(function (type) {
      html += '<button class="chip' + (state.typeFilter === type ? ' active' : '') +
        '" data-type="' + esc(type) + '">' + esc(counts[type].label) +
        '<em>' + counts[type].count + '</em></button>';
    });

    chipsEl.innerHTML = html;
  }

  function render() {
    if (!state.shadow) return;

    var shadow = state.shadow;
    var listEl = shadow.getElementById('list');
    var emptyEl = shadow.getElementById('empty');
    var subtitle = shadow.getElementById('subtitle');
    var countTotal = shadow.getElementById('count-total');
    var countSelected = shadow.getElementById('count-selected');
    var selectAllBtn = shadow.getElementById('select-all-btn');
    var downloadBtn = shadow.getElementById('download-btn');

    var visible = getVisibleAssets();
    state.visibleKeys = visible.map(function (asset) { return asset.key; });

    renderChips();

    subtitle.textContent = state.assets.length
      ? state.assets.length + ' 个素材 · ' + state.selected.size + ' 个已选'
      : '正在读取页面…';
    countTotal.textContent = String(state.assets.length);
    countSelected.textContent = String(state.selected.size);

    var selectableVisible = visible.filter(function (asset) { return !asset.missing; });
    var allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(function (asset) {
      return state.selected.has(asset.key);
    });
    selectAllBtn.textContent = allVisibleSelected ? '取消全选' : '全选';
    downloadBtn.disabled = selectedAssets().length === 0 || state.downloading;

    var scrollTop = listEl.scrollTop;
    clearHover();
    var html = '';
    for (var i = 0; i < visible.length; i++) {
      var asset = visible[i];
      var isSelected = state.selected.has(asset.key);
      html += '<div class="row' + (isSelected ? ' selected' : '') + (asset.missing ? ' missing' : '') +
        '" data-key="' + esc(asset.key) +
        '" role="option" aria-selected="' + (isSelected ? 'true' : 'false') + '" tabindex="0">' +
        '<span class="check" aria-hidden="true"></span>' +
        (asset.missing
          ? '<span class="thumb-placeholder">无图</span>'
          : '<img class="thumb" src="' + esc(asset.src) + '" alt="" loading="lazy" ' +
            'referrerpolicy="no-referrer" title="' + esc(asset.name) + '">') +
        '<div class="meta"><div class="name" title="' + esc(asset.name) + '">' + esc(asset.name) + '</div>' +
        '<div class="sub"><span class="tag">' + esc(asset.typeLabel) + '</span>' +
        (asset.missing ? '<span class="dim warn">未生图</span>'
          : (asset.w ? '<span class="dim">' + asset.w + '×' + asset.h + '</span>' : '')) +
        '</div></div></div>';
    }
    listEl.innerHTML = html;
    listEl.scrollTop = scrollTop;

    if (!visible.length) {
      emptyEl.hidden = false;
      var title = shadow.getElementById('empty-title');
      var sub = shadow.getElementById('empty-sub');
      if (!state.assets.length) {
        var stats = state.scanStats || {};
        title.textContent = '还没有发现素材';
        sub.textContent = '已扫描 ' + stats.roots + ' 个文档/ShadowRoot、' + stats.cards + ' 个卡片' +
          (stats.frames ? '（页面有 ' + stats.frames + ' 个 iframe）' : '') +
          '。如果素材加载慢请稍等，或点右上角 ↻';
      } else {
        title.textContent = '没有匹配的素材';
        sub.textContent = '换个关键词，或切回「全部」分类试试';
      }
    } else {
      emptyEl.hidden = true;
    }

    updateSelectionUI();
  }

  function updateSelectionUI() {
    if (!state.shadow) return;
    var shadow = state.shadow;
    var selectedCount = 0;

    shadow.querySelectorAll('.row').forEach(function (row) {
      var isSelected = state.selected.has(row.getAttribute('data-key'));
      row.classList.toggle('selected', isSelected);
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) selectedCount++;
    });

    var countSelected = shadow.getElementById('count-selected');
    var downloadBtn = shadow.getElementById('download-btn');
    var selectAllBtn = shadow.getElementById('select-all-btn');
    var subtitle = shadow.getElementById('subtitle');

    if (countSelected) countSelected.textContent = String(state.selected.size);
    if (downloadBtn) downloadBtn.disabled = selectedAssets().length === 0 || state.downloading;
    if (subtitle && state.assets.length) {
      subtitle.textContent = state.assets.length + ' 个素材 · ' + state.selected.size + ' 个已选';
    }

    var visible = getVisibleAssets().filter(function (asset) { return !asset.missing; });
    if (selectAllBtn) {
      var all = visible.length > 0 && visible.every(function (asset) {
        return state.selected.has(asset.key);
      });
      selectAllBtn.textContent = all ? '取消全选' : '全选';
    }
    updateRail();
  }

  /* ------------------------------------------------------------------ */
  /* Selection                                                           */
  /* ------------------------------------------------------------------ */

  function toggleRow(key, shiftKey) {
    if (!key) return;
    var clicked = findAsset(key);
    if (clicked && clicked.missing) return;

    var targetSelected = !state.selected.has(key);
    var index = state.visibleKeys.indexOf(key);

    if (shiftKey && state.lastClickedIndex >= 0 && index >= 0) {
      var from = Math.min(index, state.lastClickedIndex);
      var to = Math.max(index, state.lastClickedIndex);
      for (var i = from; i <= to; i++) {
        var rowAsset = findAsset(state.visibleKeys[i]);
        if (rowAsset && rowAsset.missing) continue;
        if (targetSelected) state.selected.add(state.visibleKeys[i]);
        else state.selected.delete(state.visibleKeys[i]);
      }
    } else {
      if (targetSelected) state.selected.add(key);
      else state.selected.delete(key);
    }

    state.lastClickedIndex = index;
    updateSelectionUI();
  }

  function toggleSelectAll() {
    var visible = getVisibleAssets().filter(function (asset) { return !asset.missing; });
    if (!visible.length) return;
    var all = visible.every(function (asset) { return state.selected.has(asset.key); });
    visible.forEach(function (asset) {
      if (all) state.selected.delete(asset.key);
      else state.selected.add(asset.key);
    });
    updateSelectionUI();
  }

  function invertSelection() {
    var visible = getVisibleAssets().filter(function (asset) { return !asset.missing; });
    visible.forEach(function (asset) {
      if (state.selected.has(asset.key)) state.selected.delete(asset.key);
      else state.selected.add(asset.key);
    });
    updateSelectionUI();
  }

  function clearHover() {
    if (state.hoverRow) {
      var asset = findAsset(state.hoverRow.getAttribute('data-key'));
      if (asset) highlight(asset, false);
      state.hoverRow = null;
    }
  }

  function highlight(asset, on) {
    var el = asset && asset.el;
    if (!el || !el.isConnected) return;
    if (on) {
      asset._prevOutline = el.style.outline;
      asset._prevOffset = el.style.outlineOffset;
      el.style.outline = '2px solid #8b5cf6';
      el.style.outlineOffset = '2px';
    } else {
      el.style.outline = asset._prevOutline || '';
      el.style.outlineOffset = asset._prevOffset || '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Download dialog                                                     */
  /* ------------------------------------------------------------------ */

  function openModal() {
    if (!state.shadow) return;
    var selected = selectedAssets();
    if (!selected.length) {
      toast('请先选择要下载的素材');
      return;
    }
    var modal = state.shadow.getElementById('modal');
    var folderInput = state.shadow.getElementById('folder-input');
    state.shadow.getElementById('modal-count').textContent = String(selected.length);
    folderInput.value = state.settings.folder || ('漫剧素材_' + LIB.dateStamp());
    updatePreview();
    modal.hidden = false;
    setTimeout(function () {
      try { folderInput.focus(); folderInput.select(); } catch (e) {}
    }, 30);
  }

  function closeModal() {
    if (!state.shadow) return;
    var modal = state.shadow.getElementById('modal');
    if (modal) modal.hidden = true;
  }

  function updatePreview() {
    if (!state.shadow) return;
    var preview = state.shadow.getElementById('path-preview');
    var folderInput = state.shadow.getElementById('folder-input');
    if (!preview || !folderInput) return;

    var selected = selectedAssets();
    var folder = LIB.sanitizeFilename(folderInput.value || '漫剧素材', 60);
    var sample = selected[0] || { name: '素材名称', typeLabel: '角色' };
    var filename = LIB.buildFilename({
      index: 0,
      total: Math.max(selected.length, 1),
      name: sample.name,
      typeLabel: sample.typeLabel,
      ext: 'png',
      pattern: 'name'
    });
    preview.textContent = '下载/' + folder + '/' + filename;
    preview.title = preview.textContent;
  }

  function confirmDownload() {
    if (!state.shadow || state.downloading) return;
    var folderInput = state.shadow.getElementById('folder-input');
    var folder = LIB.sanitizeFilename(folderInput.value, 60);
    if (!folder) {
      toast('请填写文件夹名称', 'error');
      return;
    }
    if (!selectedAssets().length) {
      toast('请先选择要下载的素材', 'error');
      closeModal();
      return;
    }
    state.settings.folder = folder;
    state.settings.pattern = 'name';
    saveSettings();
    closeModal();
    runDownload(folder, 'name');
  }

  /* ------------------------------------------------------------------ */
  /* Download pipeline                                                   */
  /* ------------------------------------------------------------------ */

  function setProgress(done, total, text) {
    if (!state.shadow) return;
    var progress = state.shadow.getElementById('progress');
    var fill = state.shadow.getElementById('bar-fill');
    var label = state.shadow.getElementById('progress-text');
    progress.hidden = false;
    fill.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    if (text) label.textContent = text;
  }

  function setProgressText(text) {
    if (!state.shadow) return;
    var label = state.shadow.getElementById('progress-text');
    if (label) label.textContent = text;
  }

  function hideProgress() {
    if (!state.shadow) return;
    var progress = state.shadow.getElementById('progress');
    if (progress) progress.hidden = true;
    var fill = state.shadow.getElementById('bar-fill');
    if (fill) fill.style.width = '0%';
    var btn = state.shadow.getElementById('download-btn');
    if (btn) btn.disabled = state.selected.size === 0;
  }

  function runDownload(folder, pattern) {
    var items = selectedAssets();
    var total = items.length;
    var done = 0;
    var failed = [];

    state.downloading = true;
    state.cancelRequested = false;
    clearTimeout(progressHideTimer);
    setProgress(0, total, '准备中…');
    updateSelectionUI();

    var index = 0;

    function next() {
      if (state.cancelRequested || index >= items.length) {
        finish();
        return;
      }
      var asset = items[index];
      setProgress(done, total, '正在处理 ' + (index + 1) + '/' + total + '：' + truncate(asset.name, 16));

      getAssetBlob(asset).then(function (blob) {
        return detectExt(blob).then(function (ext) {
          return blobToDataUrl(blob).then(function (dataUrl) {
            return sendToBackground({
              type: 'assetgrab:download',
              item: {
                folder: folder,
                pattern: pattern,
                index: done,
                total: total,
                name: asset.name,
                typeLabel: asset.typeLabel,
                ext: ext,
                dataUrl: dataUrl
              }
            });
          });
        });
      }).then(function (response) {
        if (!response || !response.ok) {
          throw new Error((response && response.error) || '下载失败');
        }
        done++;
      }).catch(function (error) {
        failed.push({ name: asset.name, error: (error && error.message) || String(error) });
      }).then(function () {
        index++;
        setProgress(done, total, '已完成 ' + done + ' / ' + total);
        setTimeout(next, 60);
      });
    }

    function finish() {
      state.downloading = false;
      updateSelectionUI();
      setProgress(done, total, '完成 ' + done + ' / ' + total);

      if (state.cancelRequested) {
        toast('已取消，已下载 ' + done + ' 个文件');
      } else if (failed.length) {
        toast('完成 ' + done + ' 个，失败 ' + failed.length + ' 个：' + truncate(failed[0].error, 40), 'error');
        try { console.warn('[AssetGrab] failed downloads', failed); } catch (e) {}
      } else {
        toast('已下载 ' + done + ' 个文件到「' + folder + '」');
      }
      clearTimeout(progressHideTimer);
      progressHideTimer = setTimeout(hideProgress, 2200);
    }

    next();
  }

  function getAssetBlob(asset) {
    var src = asset.src;
    if (!src) return Promise.reject(new Error('图片地址为空'));

    return fetchBlob(src).then(function (blob) {
      var type = String(blob.type || '').toLowerCase();
      if (type.indexOf('text/') === 0 || type.indexOf('application/json') === 0) {
        throw new Error('返回的不是图片');
      }
      return blob;
    }).catch(function () {
      // fetch(blob:) can fail on some engines; fall back to drawing the <img>.
      var img = asset.imgEl && asset.imgEl.isConnected ? asset.imgEl : null;
      if (img && img.complete && img.naturalWidth) {
        return imageToBlob(img);
      }
      return loadImageElement(src).then(imageToBlob);
    });
  }

  function fetchBlob(url) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
      }, 20000);

      fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        clearTimeout(timer);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.blob();
      }).then(function (blob) {
        if (!blob || !blob.size) throw new Error('图片数据为空');
        resolve(blob);
      }).catch(function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function loadImageElement(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = src;
    });
  }

  function imageToBlob(img) {
    return new Promise(function (resolve, reject) {
      try {
        var width = img.naturalWidth || img.width;
        var height = img.naturalHeight || img.height;
        if (!width || !height) {
          reject(new Error('图片尚未加载完成'));
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('图片转码失败'));
        }, 'image/png');
      } catch (error) {
        reject(new Error('图片受跨域限制，无法读取'));
      }
    });
  }

  function detectExt(blob) {
    var ext = LIB.extFromMime(blob.type);
    if (ext) return Promise.resolve(ext);
    try {
      return blob.slice(0, 32).arrayBuffer().then(function (buffer) {
        return LIB.sniffImageExt(new Uint8Array(buffer)) || 'png';
      }).catch(function () { return 'png'; });
    } catch (error) {
      return Promise.resolve('png');
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('读取图片数据失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function sendToBackground(message) {
    return new Promise(function (resolve, reject) {
      if (!chrome.runtime || !chrome.runtime.id) {
        reject(new Error('插件已更新，请刷新页面后重试'));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, function (response) {
          var error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      } catch (error) {
        reject(new Error('插件已更新，请刷新页面后重试'));
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  function toast(message, kind, duration) {
    if (!state.shadow) return;
    var el = state.shadow.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, duration || 3600);
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  function maybeAutoOpen() {
    if (!state.assets.length) return;
    if (!state.settings.autoOpen) return;
    if (safeSessionGet(CLOSED_KEY)) return;
    if (!state.open) showPanel();
  }

  function bootstrap() {
    loadSettings().then(function () {
      createUI();
      observePage();

      var tries = 0;
      var timer = setInterval(function () {
        syncAssets();
        if (state.assets.length) {
          clearInterval(timer);
          maybeAutoOpen();
        } else if (++tries > 120) {
          clearInterval(timer);
        }
      }, 500);
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'assetgrab:ping') {
      sendResponse({ ok: true, count: state.assets.length });
      return;
    }
    if (message.type === 'assetgrab:toggle') {
      if (!state.host) createUI();
      togglePanel();
      sendResponse({ ok: true });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
