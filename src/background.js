/**
 * AssetGrab background script.
 * Compatible with MV3 service worker (Chrome / Edge / QQ) and MV2 background page.
 */
'use strict';

if (typeof importScripts === 'function') {
  try { importScripts('lib.js'); } catch (e) { /* MV2 background page loads lib.js via manifest */ }
}

var LIB = self.AssetLib;
var actionApi = chrome.action || chrome.browserAction;

function log() {
  try { console.log.apply(console, ['[AssetGrab]'].concat([].slice.call(arguments))); } catch (e) {}
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function getActiveTab() {
  return LIB.apiCall(chrome.tabs.query, chrome.tabs, [{ active: true, currentWindow: true }])
    .then(function (tabs) { return tabs && tabs[0]; });
}

function ping(tabId) {
  return LIB.apiCall(chrome.tabs.sendMessage, chrome.tabs, [tabId, { type: 'assetgrab:ping' }])
    .then(function (res) { return !!(res && res.ok); })
    .catch(function () { return false; });
}

function injectContent(tabId) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return LIB.apiCall(chrome.scripting.executeScript, chrome.scripting, [{
      target: { tabId: tabId },
      files: ['lib.js', 'content.js']
    }]);
  }
  if (chrome.tabs && chrome.tabs.executeScript) {
    return LIB.apiCall(chrome.tabs.executeScript, chrome.tabs, [tabId, { file: 'lib.js' }])
      .then(function () {
        return LIB.apiCall(chrome.tabs.executeScript, chrome.tabs, [tabId, { file: 'content.js' }]);
      });
  }
  return Promise.reject(new Error('当前浏览器不支持动态注入脚本，请刷新页面后重试'));
}

function togglePanelOnTab(tab) {
  if (!tab || !tab.id) return Promise.resolve();
  var tabId = tab.id;
  return ping(tabId).then(function (alive) {
    if (alive) return null;
    return injectContent(tabId).then(function () { return sleep(150); });
  }).then(function () {
    return LIB.apiCall(chrome.tabs.sendMessage, chrome.tabs, [tabId, { type: 'assetgrab:toggle' }]);
  }).catch(function (err) {
    log('cannot toggle panel:', err && err.message);
    // Give a visible hint: a red "!" badge on the toolbar icon.
    try {
      if (actionApi && actionApi.setBadgeText) {
        actionApi.setBadgeText({ tabId: tabId, text: '!' });
        actionApi.setBadgeBackgroundColor({ tabId: tabId, color: '#e5484d' });
        setTimeout(function () {
          try { actionApi.setBadgeText({ tabId: tabId, text: '' }); } catch (e) {}
        }, 3000);
      }
    } catch (e) {}
  });
}

if (actionApi && actionApi.onClicked) {
  actionApi.onClicked.addListener(function (tab) {
    togglePanelOnTab(tab);
  });
}

/** Download one data: URL into "<folder>/<generated name>". */
function downloadItem(item) {
  var folder = LIB.sanitizeFilename(item.folder || '漫剧素材', 60);
  var filename = folder + '/' + LIB.buildFilename({
    index: item.index,
    total: item.total,
    name: item.name,
    typeLabel: item.typeLabel,
    ext: item.ext,
    pattern: item.pattern
  });

  return new Promise(function (resolve, reject) {
    chrome.downloads.download({
      url: item.dataUrl,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, function (downloadId) {
      var err = chrome.runtime.lastError;
      if (err || downloadId === undefined) {
        reject(new Error((err && err.message) || '浏览器拒绝了下载请求'));
        return;
      }
      resolve({ downloadId: downloadId, filename: filename });
    });
  });
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Fetch an image in the extension context to bypass page CORS. */
function fetchImage(url) {
  return fetch(url, { credentials: 'include', cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var mime = response.headers.get('content-type') || '';
    return response.arrayBuffer().then(function (buffer) {
      if (!buffer.byteLength) throw new Error('图片内容为空');
      return { base64: arrayBufferToBase64(buffer), mime: mime };
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'assetgrab:ping') {
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'assetgrab:fetch-image') {
    if (!msg.url) {
      sendResponse({ ok: false, error: '缺少图片地址' });
      return;
    }
    fetchImage(msg.url).then(function (result) {
      sendResponse({ ok: true, base64: result.base64, mime: result.mime });
    }).catch(function (err) {
      log('fetch image failed:', err && err.message);
      sendResponse({ ok: false, error: (err && err.message) || '读取图片失败' });
    });
    return true;
  }

  if (msg.type === 'assetgrab:download') {
    downloadItem(msg.item || {}).then(function (result) {
      sendResponse({ ok: true, downloadId: result.downloadId, filename: result.filename });
    }).catch(function (err) {
      log('download failed:', err && err.message);
      sendResponse({ ok: false, error: (err && err.message) || '下载失败' });
    });
    return true;
  }

  if (msg.type === 'assetgrab:download-check') {
    chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] }, function (items) {
      sendResponse({ ok: true, items: items || [] });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(function () {
  log('installed');
});
