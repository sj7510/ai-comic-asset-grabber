/**
 * AssetGrab shared helpers.
 * Loaded as a classic script by both the content script and the background page,
 * so it must not use ES module syntax.
 */
(function (global) {
  'use strict';

  var TYPE_LABELS = {
    character: '角色',
    prop: '道具',
    scene: '场景',
    costume: '服装',
    vehicle: '载具',
    effect: '特效',
    creature: '生物',
    item: '物品',
    location: '地点',
    storyboard: '分镜',
    other: '其他'
  };

  var IMAGE_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico'
  };

  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  /**
   * "character:大胤前军·绯黑前军甲" -> { type, typeLabel, name, key }
   * Only the first colon separates the type; names may contain colons.
   */
  function parseAssetKey(key) {
    var raw = String(key == null ? '' : key).trim();
    var cut = raw.indexOf(':');
    if (cut < 0) {
      return { key: raw, type: 'other', typeLabel: TYPE_LABELS.other, name: raw };
    }
    var type = raw.slice(0, cut).trim() || 'other';
    var name = raw.slice(cut + 1).trim() || raw;
    return {
      key: raw,
      type: type,
      typeLabel: TYPE_LABELS[type] || type,
      name: name
    };
  }

  /** Make a single path segment safe on Windows / macOS / Linux. */
  function sanitizeFilename(input, maxLength) {
    var name = String(input == null ? '' : input)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    if (!name) name = '未命名';
    var limit = maxLength || 80;
    if (name.length > limit) {
      name = name.slice(0, limit).replace(/[.\s]+$/g, '');
    }
    if (RESERVED.test(name)) name = '_' + name;
    return name;
  }

  function extFromMime(mime) {
    var clean = String(mime == null ? '' : mime).toLowerCase().split(';')[0].trim();
    return IMAGE_EXT[clean] || '';
  }

  /** Detect an image extension from the first bytes of a file. */
  function sniffImageExt(bytes) {
    if (!bytes || bytes.length < 12) return '';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      var brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
      if (brand.indexOf('avif') >= 0) return 'avif';
      if (brand.indexOf('heic') >= 0 || brand.indexOf('heix') >= 0) return 'heic';
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
    var head = '';
    for (var i = 0; i < Math.min(64, bytes.length); i++) head += String.fromCharCode(bytes[i]);
    if (/^\s*(<\?xml|<!--|<svg)/i.test(head)) return 'svg';
    return '';
  }

  /**
   * buildFilename({ index, total, name, typeLabel, ext, pattern })
   * pattern: "index" -> 001_名称, "name" -> 名称, "type" -> 角色_名称
   */
  function buildFilename(opts) {
    var index = Number(opts.index) || 0;
    var total = Number(opts.total) || 1;
    var pattern = opts.pattern || 'index';
    var name = sanitizeFilename(opts.name, 70);
    var typeLabel = sanitizeFilename(opts.typeLabel || '素材', 12);
    var ext = opts.ext ? '.' + String(opts.ext).replace(/^\./, '').toLowerCase() : '';
    var digits = String(total).length > 2 ? String(total).length : 3;
    var num = String(index + 1);
    while (num.length < digits) num = '0' + num;
    var base;
    if (pattern === 'name') base = name;
    else if (pattern === 'type') base = typeLabel + '_' + name;
    else base = num + '_' + name;
    return base + ext;
  }

  function dateStamp(date) {
    var d = date ? new Date(date) : new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  /**
   * Call a chrome.* API that may use either callbacks (MV2 / older Chromium)
   * or promises (MV3). Resolves with the callback argument or promise value.
   */
  function apiCall(fn, thisArg, args) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var callback = function (result) {
        if (settled) return;
        settled = true;
        var err = global.chrome && global.chrome.runtime && global.chrome.runtime.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(result);
      };
      var maybe;
      try {
        maybe = fn.apply(thisArg, (args || []).concat([callback]));
      } catch (e) {
        reject(e);
        return;
      }
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(function (value) {
          if (!settled) { settled = true; resolve(value); }
        }, function (error) {
          if (!settled) { settled = true; reject(error); }
        });
      }
    });
  }

  var storage = {
    get: function (keys) {
      return apiCall(global.chrome.storage.local.get, global.chrome.storage.local, [keys]);
    },
    set: function (items) {
      return apiCall(global.chrome.storage.local.set, global.chrome.storage.local, [items]);
    }
  };

  global.AssetLib = {
    TYPE_LABELS: TYPE_LABELS,
    parseAssetKey: parseAssetKey,
    sanitizeFilename: sanitizeFilename,
    extFromMime: extFromMime,
    sniffImageExt: sniffImageExt,
    buildFilename: buildFilename,
    dateStamp: dateStamp,
    apiCall: apiCall,
    storage: storage
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
