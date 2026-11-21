# 漫剧素材抓取插件 · AI 开发交接文档

> 最后更新：2026-11-21（v1.3.0）  
> 项目目录：`ai-comic-asset-grabber/`  
> 用途：把这份文档连同代码一起交给任何 AI Agent，让它先读这里，再改代码。

---

## 0. 给 AI Agent 的快速指令

1. **先读这份文档**，再读 `src/content.js`、`src/lib.js`、`src/background.js`。
2. 改完必须跑：
   ```powershell
   node test/unit.mjs
   node build.mjs
   ```
   涉及扫描、选择、下载、拖动的改动，再跑 `test/e2e.mjs`。
3. 不要引入 npm 运行时依赖；当前扩展是纯原生 JS，`build.mjs` 只做文件复制。
4. 不要删除 MV2 版本：老版 QQ 浏览器可能只认 `dist/qq-mv2`。
5. 不要重新加回「命名方式」下拉框，用户明确要求文件名就是素材名称。
6. 不要重新加回「未生图」卡片，列表只显示有图片的「已生成」素材。
7. 不要恢复「离屏缓存」：卡片离开 DOM 后，列表和选中状态都要一起删掉。
8. 新站点只认状态文案「图片已生成」；`generating` / failed 卡片不要进列表。
9. 新站下载必须走 `.asset-image-status a[href*="/download/"]` 原图接口，**不要用 `img.media-generation-content` 的 WebP 缩略图**；原图失败要报错，不能静默降级。
10. 自定义保存位置依赖 File System Access API：目录 handle 存在 IndexedDB，写入前必须检查重名；默认「跳过重名」。
11. 交互文案用中文，安装文档要写到非技术人员能照着点。
12. 识别/下载诊断：`state.scanStats`、`state.scanIssues`、`state.lastDownloadReport`；标题/底部小 `i` 悬浮展示，改扫描计数时同步维护这些字段。

---

## 1. 项目是什么

一个浏览器扩展（Chrome 内核），在「漫剧平台」的资产库页面右侧注入一个浮层面板：

- 自动扫描页面里的素材卡片（图片 + 名称），只保留状态为「图片已生成」的卡片；
- 列表展示缩略图、名称、类型、分辨率；
- 支持多选、Shift 连选、全选 / 反选 / 清空、搜索、按类型筛选；
- 点「下载」后可以选择**任意保存文件夹**（File System Access API），批量写入；不选文件夹时回退到浏览器下载目录 + 文件夹名；
- 下载前检查目标文件夹里是否已有同名文件，默认跳过（不覆盖），可在弹窗里取消勾选改为覆盖；
- 面板可拖动，位置会记住；
- 只显示当前页面 DOM 里已生成的素材。

目标平台（新）：

```
https://photo.colo14.top/
```

兼容旧平台：

```
http://yinghuo.clouded.top:6912
```

扩展只对这两个域名（含任意端口）注入，其它网站不生效。图片 CDN：
`https://video-gen-uploads.tos-cn-beijing.volces.com/`（新站图片的 host 权限）。

---

## 2. 用户需求演进（重要决策记录）

| 阶段 | 用户要求 | 最终实现 |
| --- | --- | --- |
| 最初 | 抓页面图片和名称，侧边栏多选，输入文件夹名下载 | 页面右侧浮层面板 + data URL 下载 |
| 平台 | 优先 QQ 浏览器，其次主流浏览器 | Chromium 优先；MV3 + MV2 双包 |
| DOM 变化 | `data-asset` 从 `character:名称` 变成纯 ID `u179...` | 名称改为优先读 `<strong>`，其次 `img[alt]` |
| 扫描失败 | 面板显示 0 | 支持同源 iframe、开放 Shadow DOM 深度扫描；未生图跳过 |
| 换站 | 新站 `photo.colo14.top`，卡片没有 `data-asset` | 站点适配器：按 hostname 选选择器；key 回退到图片 URL |
| 新站状态 | 只要「图片已生成」 | `.asset-image-status` 文案/成功类校验，其它状态跳过 |
| 保存位置 | 不要默认下载目录，要自定义路径 | 目录选择器 + 目录 handle 持久化 |
| 重名 | 合作生成有重复资产，重名默认不下载 | 写入前 `getFileHandle` 检查；默认跳过，可关闭 |
| 命名 | 下拉框空白，不要命名方式，默认名称 | 删除 `<select>`，文件名固定为素材名 |
| 未生图 | 不要显示 | 扫描阶段直接跳过 `src` 为空的卡片 |
| 离屏 | 不要保留离屏素材，关闭/刷新只展示当前页 | 每次扫描只保留当前 DOM，选中 key 同步裁剪 |
| 面板 | 固定死，想拖动 | 标题栏 PointerEvent 拖动，位置持久化，双击复位 |

---

## 3. 技术栈与约束

- **纯原生 JavaScript**（ES5 风格为主，避免新语法导致老 Chromium 不认）。
- **Manifest V3 + Manifest V2 双版本**，同一套 JS，只换 manifest。
- 无 npm 依赖；`build.mjs` 只用 Node 内置模块。
- 无后端、无上传；图片只在本地页面上下文取字节，交给浏览器下载。
- 目标浏览器：QQ 浏览器（极速模式）、Chrome、Edge；Firefox 未实现。

权限（MV3）：

```json
"permissions": ["downloads", "storage", "scripting"],
"host_permissions": [
  "https://photo.colo14.top/*",
  "http://photo.colo14.top/*",
  "https://yinghuo.clouded.top/*",
  "http://yinghuo.clouded.top/*",
  "https://video-gen-uploads.tos-cn-beijing.volces.com/*"
]
```

MV2 使用 `"permissions"` 直接包含域名，背景页为 `background.scripts`。
File System Access 不需要额外 manifest 权限，但需要 HTTPS 页面和用户点击。

---

## 4. 目录结构

```
ai-comic-asset-grabber/
├── src/
│   ├── lib.js                 # 名称解析、文件名清洗、扩展名识别、chrome API 兼容层
│   ├── content.js             # 扫描 + 浮层面板 + 选择 + 下载流程 + 拖动（核心，约 1400 行）
│   ├── background.js          # 工具栏按钮、消息处理、chrome.downloads 下载
│   ├── manifest.mv3.json
│   ├── manifest.mv2.json
│   └── icons/                 # 16/32/48/128 图标
├── demo/
│   ├── index.html             # 本地演示页，新站 DOM：18 个卡片（17 已生成 + 1 生成中）
│   └── server.mjs             # 127.0.0.1:6912 静态服务器
├── test/
│   ├── unit.mjs               # 12 个纯逻辑测试
│   └── e2e.mjs                # 无依赖 CDP 端到端测试
├── tools/
│   ├── make_icons.py
│   ├── make_install_doc.py    # 生成安装教程 DOCX
│   └── verify_install_doc.py
├── docs/
│   ├── 素材抓取插件-安装教程.docx
│   └── 素材抓取插件-安装教程.pdf
├── build.mjs                  # 生成 dist/qq-mv3、dist/qq-mv2
├── dist/                      # 可加载 / 可分发产物
└── README.md
```

### 各文件职责

**`src/lib.js`**
- `parseAssetKey(key)`：`character:名称` → `{type,typeLabel,name}`；纯 ID → `type=other`。
- `sanitizeFilename()`：替换 Windows 非法字符、去首尾点/空格、处理 `CON` 等保留名、限长。
- `sniffImageExt()` / `extFromMime()`：判断 png/jpg/webp/gif/avif。
- `buildFilename()`：本项目固定用 `pattern='name'`，即直接用名称。
- `apiCall()`：兼容 MV2 回调式 / MV3 Promise 式 chrome API。
- `storage.get/set`：`chrome.storage.local` 封装。

**`src/content.js`**
- `SITE`：站点选择器（改版只改这里）。
- `collectRoots()`：`document` + 同源 iframe + 开放 Shadow DOM，上限 120 个 shadow root。
- `scanPage()`：产出 asset 数组与 `state.scanStats`；跳过无图卡片。
- `syncAssets()`：只保留当前 DOM 的卡片，并裁剪 `state.selected`。
- `render()`：Shadow DOM 内渲染列表、分类 chips、空状态。
- 面板拖动：`onHeaderPointerDown/Move`、`finishDrag()`、`resetPanelPosition()`。
- 下载：`runDownload()` → `getAssetBlob()` → `blobToDataUrl()` → 发消息给后台。
- 自动打开：`bootstrap()` 500ms 轮询 60 秒 + `MutationObserver` 450ms 防抖。

**`src/background.js`**
- `chrome.action.onClicked`：面板开关；页面没注入时用 `chrome.scripting` 补注入。
- 接收 `assetgrab:download`，调用 `chrome.downloads.download({ url:dataUrl, filename })`。
- MV2 下用 `chrome.browserAction` / `chrome.tabs.executeScript` 兜底。

---

## 5. 站点 DOM 与适配器

### 5.1 新站（主）：`photo.colo14.top`

```html
<article class="asset-card">
  <label class="asset-select">
    <input aria-label="选择Emma Carter" type="checkbox"><span></span>
  </label>

  <div class="asset-image-wrap" aria-busy="false">
    <div class="asset-image-frame media-generation-surface is-media-ready">
      <img class="media-generation-content" alt="Emma Carter资产图"
           referrerpolicy="no-referrer"
           src="https://video-gen-uploads.tos-cn-beijing.volces.com/results/xxx.png">
      <button class="asset-thumbnail-hitarea">查看大图 ↗</button>
    </div>
    <div class="asset-image-status success" role="status">
      <span class="asset-status-dot"></span>图片已生成
      <small>任务 media_...</small>
      <a href="/gateway/media/jobs/media_.../download/0">下载图片</a>
    </div>
  </div>

  <button class="asset-card-copy" aria-label="查看Emma Carter详情">
    <strong>Emma Carter</strong>
    <small>lead</small>
    <em>episode-29 · episode-30</em>
  </button>

  <div class="asset-card-actions">...</div>
  <p class="character-prompt-status success">资产提示词可用</p>
</article>
```

规则：

- 卡片：`article.asset-card`。
- 状态：`.asset-image-status`，文本必须包含 **「图片已生成」**，或带 `success` 类；`生成中` / 失败卡片跳过。
- 名称：`.asset-card-copy strong`；回退 `img[alt]`（去掉结尾「资产图」）→ `.asset-select input[aria-label]`（去掉开头「选择」）。
- 缩略图：`img.media-generation-content`；回退 `.asset-image-frame img`，再回退 `img`。**只用于面板预览**。
- 原图：`.asset-image-status a[href*="/download/"]`，href 形如 `/gateway/media/jobs/media_xxx/download/0`；下载时优先请求它。
- 没有 `data-asset`；key 优先用原图下载 URL，其次缩略图 URL 去掉 query，保证重扫稳定。
- 类型未知，统一 `type=other`、`typeLabel=素材`。
- 缩略图是 WebP（`video-gen-uploads.tos-cn-beijing.volces.com`），画质差；原图必须走下载链接。

### 5.2 旧站（兼容）：`yinghuo.clouded.top`

```html
<article class="asset-card" data-asset="character:大胤前军·绯黑前军甲">
  <span class="media-slot"><img src="blob:http://yinghuo.clouded.top:6912/..."></span>
  <strong>大胤前军·绯黑前军甲</strong>
</article>
```

- 名称：`:scope > strong`。
- 图片：`.media-slot img` → `img`。
- key：`data-asset`（`type:name` 或纯 ID）。
- 没有状态过滤。
- 旧站图片是 `blob:`，只在页面存活期间有效。

### 5.3 适配器实现

```js
var ADAPTERS = [
  {
    hosts: ['photo.colo14.top'],
    card: 'article.asset-card',
    image: 'img.media-generation-content',
    name: '.asset-card-copy strong',
    altSuffix: '资产图',
    status: '.asset-image-status',
    statusText: '图片已生成',
    download: '.asset-image-status a[href*="/download/"]'
  },
  {
    hosts: ['yinghuo.clouded.top'],
    card: 'article.asset-card',
    media: '.media-slot img',
    image: 'img',
    name: ':scope > strong'
  }
];
var SITE = pickSite();   // 按 location.hostname 选
```

### 5.4 图片字节怎么拿

- **新站优先原图**：`asset.downloadUrl`（相对 `/gateway/media/jobs/.../download/0` 解析成绝对 URL）。
  1. 内容脚本 `fetch(downloadUrl, {credentials:'include'})`（同源，带登录 Cookie）；
  2. 失败则后台 `fetch-image` 兜底（扩展 host 权限）；
  3. 校验返回 MIME / 文件头必须是图片；**原图失败直接报错，不静默回退到 WebP**；
  4. 拿到 Blob 后写本地目录或转 data URL。
- 缩略图 `asset.src`（WebP）只用于面板预览，不用于下载。
- 旧站是 `blob:`：内容脚本直接 `fetch`；失败时把 `<img>` 画进 canvas 兜底。
- background 需要 `video-gen-uploads.tos-cn-beijing.volces.com` 的 host 权限（缩略图 CDN）；原图接口与页面同源。

### 5.5 画质

- 新站 `img.media-generation-content` 是 **WebP 缩略图**，画质差；下载必须走 `downloadUrl` 原图接口。
- 面板行会带「原图」标签表示存在原图链接。
- 旧站 `data-cache` 是 `...|640`，抓到的是 640 宽预览图。

---

## 6. 数据流与关键机制

```
页面 DOM
  │  scanPage()（每 500ms 前 60 秒 + MutationObserver）
  ▼
state.assets[] ──► render() ──► Shadow DOM 面板
  │                                │
  │ 勾选                           │ 下载（可选自定义目录）
  ▼                                ▼
state.selected(Set)           runDownload()
                                   │ getAssetBlob()
                                   │  ├─ 内容脚本 fetch(HTTPS/blob)
                                   │  └─ 失败 → background fetch-image → base64
                                   ▼
                 ┌─────────────────┴─────────────────┐
                 │ 已选文件夹（File System Access）   │ 未选文件夹（默认）
                 ▼                                   ▼
     writeBlobToDir(dir, blob, name, overwrite)   blobToDataUrl()
       ├─ getFileHandle 检查重名                    → runtime.sendMessage(download)
       ├─ 重名且勾选跳过 → skipped                   → chrome.downloads.download
       └─ createWritable().write(blob)               （conflictAction=uniquify）
```

### 关键存储

| Key | 位置 | 内容 |
| --- | --- | --- |
| `assetgrab:settings` | `chrome.storage.local` | `{ folder, pattern:'name', autoOpen, pos:{left,top,width,height}, skipExisting }` |
| `assetgrab:closed` | `sessionStorage` | 当前标签页关过面板，避免自动弹出 |
| `saveDir` | 页面 origin 的 IndexedDB（`assetgrab-fs` / `handles`） | 用户选择的目录 `FileSystemDirectoryHandle` |

> 目录 handle 存在**页面 origin** 的 IndexedDB 里（content script 与页面同源），不是 `chrome.storage`；`chrome.storage` 不能结构化克隆 handle。

### 消息

| type | 方向 | 作用 |
| --- | --- | --- |
| `assetgrab:ping` | 后台 → 内容脚本 | 判断页面是否已注入 |
| `assetgrab:toggle` | 后台 → 内容脚本 | 打开/关闭面板 |
| `assetgrab:fetch-image` | 内容脚本 → 后台 | 跨域图片取字节，返回 base64 + MIME |
| `assetgrab:download` | 内容脚本 → 后台 | 默认目录模式下载单张图 |
| `assetgrab:download-check` | 调试用 | 查询最近下载 |

### 下载细节

- 文件名：`sanitizeFilename(名称)` + 扩展名，**没有序号前缀**。
- 扩展名：MIME → 文件头 sniff → 兜底 `png`。
- **自定义目录模式**：
  - 目录 handle 通过 `showDirectoryPicker({mode:'readwrite'})` 获取；
  - 写入前 `getFileHandle(name)` 判断是否存在；
  - `skipExisting=true`（默认）时，存在就跳过并计数，不覆盖；
  - 取消勾选后 `createWritable()` 直接覆盖；
  - 目录权限失效时提示重新选择。
- **默认下载目录模式**：
  - `conflictAction: 'uniquify'`，重名自动加 `(1)`，**无法跳过**（浏览器 API 不能扫描下载目录）；
  - 弹窗里的「重名跳过」会禁用，并提示先选文件夹。
- 每张间隔约 60ms，避免瞬间大量下载。
- 单张 fetch 超时 20 秒；失败不影响其它图片。
- 若返回 `text/html` / `application/json`，视为失败，避免把登录页存成图片。


---

### 诊断信息（v1.3.0）

- `state.scanStats`：
  - `cards` 页面卡片总数
  - `withImage` 有非空 `src` 的卡片数（包含状态不通过的）
  - `recognized` 实际进入面板的数量
  - `statusSkipped` / `noImage` / `emptySrc` / `duplicates` 分类计数
  - `frames` / `roots` / `shadows` 扫描范围
- `state.scanIssues[]`：`{name, reason}`，每张未识别卡片一条；原因如「状态不是『图片已生成』」「图片地址为空（可能加载失败）」「没有找到图片元素」「重复素材」。
- `state.lastDownloadReport`：`{done, skipped, skippedNames, failed:[{name,error}], cancelled, at, folder}`。
- UI：
  - 标题旁 `#scan-info` 悬浮/点击 → `#info-pop`，显示卡片数/有图数/已识别/未识别明细（最多 60 条）。
  - 底部 `#download-info` 和下载成功 toast 里的小 `i` → 同一个 `#info-pop`，显示成功/跳过/失败明细（最多 40 条）。
- 统计口径：`cards - recognized = issues.length`；`withImage` 可能大于 `recognized`（状态不通过但图片仍在）。
- 状态文本要用 `cleanStatusText()`，不要直接 `statusEl.textContent`，否则会把「任务 xxx」「下载图片」拼进原因里。

## 7. 已踩过的坑（不要重复踩）

### 7.1 原生 `<select>` 在 QQ 里选项空白

深色自定义 `<select>` 在 QQ/旧 Chromium 下，下拉选项文字色继承浅色，弹层背景是白色 → 看不见。

**已彻底删除命名下拉框**。不要再加原生 select；如必须加，需显式设置 `option { color: #111; background: #fff; }` 并实测。

### 7.2 Chrome 137+ 正式版不能命令行加载扩展

`--load-extension` 在品牌 Chrome 137+ 被禁用。自动 E2E 需用 **Chrome for Testing** 或 Edge；用户手动「加载已解压」不受影响。

别把「E2E 起不来」误判成插件坏了。

### 7.3 Windows 沙箱下 Chrome 启不来

报错类似：

```
FATAL:mojo\public\cpp\platform\platform_channel.cc:112 Check failed: 拒绝访问 (0x5)
```

或 `crashpad OpenProcess 0x5`。这是进程/命名管道被限制，不是代码问题。需要完整权限运行，且加：

```
--no-sandbox --disable-crash-reporter --disable-breakpad
```

### 7.4 Edge 92 截图中文像被“压扁”

Edge 92 的旧渲染器截图中文字会显得纵向被压扁，但同一份代码在 Chrome 157 正常。**不是 CSS bug**，不要为此改字号/行高。

### 7.5 离屏素材不能留

早期为了“滚出去也能下载”，把选中但离开 DOM 的卡片保留为 `已离屏`。用户明确不要。现在：

- `syncAssets()` 只保留本次 `scanPage()` 结果；
- `state.selected` 里不存在于当前资产的 key 全部删除；
- MutationObserver 必须监听 `removedNodes`，否则卡片被删除时不会重扫。

### 7.6 `blob:` 地址会失效

卡片被虚拟列表移除后 blob 可能被回收。下载时 fetch 失败会走 canvas 兜底；仍失败则提示。

### 7.7 下载文件夹依赖浏览器设置

`chrome.downloads.download` 的 `filename` 带 `/` 会在下载目录里建子文件夹。若用户开启「每次下载前询问保存位置」，会每张弹窗。安装文档第 5 步专门讲这个。

### 7.8 面板高度与拖动

面板默认 `top/bottom:16px` 撑满；拖动时改为固定 `left/top/width/height`。
向下拖时自动缩短高度（`window.innerHeight - top - 8`），保证底部按钮可见。
双击标题栏清空 `settings.pos` 恢复默认。

### 7.9 自定义目录不是下载 API

`chrome.downloads.download` 只能写到默认下载目录，不能选任意路径。自定义路径只能用 File System Access：

- `showDirectoryPicker` 必须在**用户点击**里调用，且页面是 HTTPS；
- 目录 handle 存页面 origin 的 IndexedDB；浏览器重启后可能变 `prompt`，需要 `requestPermission`；
- 不选文件夹时回退到 downloads API，此时无法扫描重名；
- QQ / 旧 Chromium 可能不支持，按钮会禁用。

### 7.10 新站图片是跨域 CDN

新站 `img.src` 是 `https://video-gen-uploads.tos-cn-beijing.volces.com/...`。内容脚本直接 `fetch` 可能被 CORS 拦，必须：

- manifest 加该 CDN 的 host 权限；
- 后台 `fetch-image` 兜底，返回 base64；
- CDN 换域名时同步 manifest，否则下载会失败。

### 7.11 重名默认跳过

合作生成会出现同名资产。默认 `skipExisting=true`，写入前 `getFileHandle` 检查，存在就跳过。
只有在**已选择文件夹**时有效；默认下载目录模式仍是 `uniquify`（加 `(1)`）。

---

## 8. 测试

### 单元测试

```powershell
node test/unit.mjs
```

覆盖：`parseAssetKey`、文件名清洗、保留名、`buildFilename`、MIME、文件头 sniff、日期。当前 12 项全过。

### 端到端测试

`test/e2e.mjs` 不依赖 Playwright/Puppeteer，使用 Node 内置 `WebSocket` 直接跑 CDP：

- 启动 `demo/server.mjs`（127.0.0.1:6912）
- 用 `--host-resolver-rules=MAP photo.colo14.top 127.0.0.1` 让演示页命中真实 host 权限
- 加载 `dist/qq-mv3` 或 `dist/qq-mv2`
- 验证：18 个卡片 → 面板 17 行（跳过 1 个「生成中」）→ 17 个「原图」标签 → 识别提示显示「页面卡片 18 / 有图 18 / 已识别 17 / 未识别 1」→ 搜索 1 行 → Shift 连选 5 个 → 全选 17 → 下载 17 个文件 → 文件名 `大胤前军·绯黑前军甲.png` → 文件 2515 字节（证明走原图接口，不是 ~280KB 缩略图）
- 再模拟 1 个原图接口 404：下载结果显示「成功 15 / 失败 1」，失败明细包含 `原图下载失败：HTTP 404`。
- 再删掉 1 个卡片，验证列表 16 行、已选 16
- 用 PointerEvent 拖标题栏，验证面板 left 移动 ≥100px

运行示例：

```powershell
# Chrome for Testing / Chromium（MV3）
$env:CHROME_PATH = "C:\path\to\chrome.exe"
$env:E2E_EXT_DIR = "dist/qq-mv3"
node test/e2e.mjs

# 本机 Edge 92（MV2，需要 headed 才能稳定下载）
$env:CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:E2E_EXT_DIR = "dist/qq-mv2"
$env:E2E_HEADED = "1"
node test/e2e.mjs
```

环境变量：

- `CHROME_PATH`：浏览器 exe。
- `E2E_EXT_DIR`：相对项目根的扩展目录。
- `E2E_HEADED`：非空则显示窗口（老 Edge 下载需要）。
- `E2E_SINGLE_PROCESS`：调试用，一般不需要。

测试会写 `test/.tmp/`（profile、下载目录、chrome.log）。截图已从 E2E 移除，避免 Edge 92 截图卡住。

Chrome for Testing 可以用镜像下载：

```
https://cdn.npmmirror.com/binaries/chrome-for-testing/<version>/win64/chrome-win64.zip
```

（本机曾用 157.0.8103.38 验证 MV3；下载后不需要提交进仓库。）

### 已验证环境

- Edge 92 + `dist/qq-mv2`（v1.3.0）：新站演示 DOM 18 卡片 → 17 行；17/17 下载通过；下载文件来自原图接口（2515 字节）；识别/下载提示、模拟 404 失败明细、删除卡片同步、拖动均通过。
- Chrome for Testing 157 + `dist/qq-mv3`：v1.0.0 下载/命名/文件夹校验通过；v1.3.0 的扫描/下载逻辑与 MV2 共用，但**新站 MV3 未复测**。
- 自定义保存文件夹：File System Access 的系统目录选择器无法自动化，需在真实 HTTPS 页面手动验证（选目录、重名跳过、覆盖、权限失效）。
- QQ 浏览器：**未实机验证**（本机未安装），只按 Chromium 兼容处理。

---

## 9. 构建与发布

```powershell
node build.mjs
```

生成：

- `dist/qq-mv3/`（manifest v3）
- `dist/qq-mv2/`（manifest v2）

`build.mjs` **不会**打 zip。发布前手动：

```powershell
Compress-Archive -Path "dist\qq-mv3\*" -DestinationPath "dist\qq-mv3.zip" -Force
Compress-Archive -Path "dist\qq-mv2\*" -DestinationPath "dist\qq-mv2.zip" -Force
```

zip 根目录必须直接是 `manifest.json`、`background.js` 等，不能多套一层文件夹。

QQ 安装：`qqbrowser://extensions` → 开发者模式 → 加载已解压 → 选 `dist/qq-mv3`；不支持 MV3 时换 `qq-mv2`。

---

## 10. 修改指南

### 改站点选择器

只改 `src/content.js` 顶部 `SITE`，然后跑 E2E。  
若名称不在 `<strong>`、图片不在 `.media-slot img`，优先调整 `SITE`，不要改扫描逻辑。

### 加新的资产类型文案

改 `src/lib.js` 的 `TYPE_LABELS`（如 `prop: '道具'`）。纯 ID 的 `data-asset` 无法得知类型，会显示 `other`；如有 `data-type` 属性，可在 `scanPage()` 里读取。

### 改文件名规则

当前固定 `pattern='name'`。若用户改主意要序号：

- 弹窗/流程传 `pattern='index'`；
- `lib.buildFilename()` 已支持 `index/name/type`；
- 注意同步改 `updatePreview()`、`confirmDownload()`、`runDownload()`。

### 换下载方式（zip / 选择任意目录）

- 当前用 `chrome.downloads` + 子目录，最稳。
- 想打包 zip：需要引入 zip 库或在后台实现；注意 MV3 Service Worker 不能 `URL.createObjectURL`。
- 想用 File System Access API：只能在扩展页面（side panel/options）里调用，content script 里没有；需要重构面板宿主。

### 加原生 Chrome 侧边栏

当前是页面内浮层（QQ 没有可靠 sidePanel API）。若要加 `chrome.sidePanel`：

- 需要单独的扩展页面 UI；
- 内容脚本扫描结果通过 `chrome.runtime` 传给侧边栏；
- 下载要在扩展页面/后台完成；
- 浮层仍要保留给 QQ。工作量大，非必要不做。

### 支持跨域 iframe

当前 `collectRoots()` 只能读**同源** iframe。若素材在跨域 iframe：

- manifest 加 `"all_frames": true`；
- 子 frame 扫描后通过 `chrome.runtime` 汇总到后台；
- 下载必须在子 frame 内 fetch blob（跨域 blob 不能拿到父页面）；
- 需要按 frameId 路由下载消息。复杂，先确认是否真的跨域。

### 加缩放/调整大小

拖动只改了位置和高度自适应。若要拖右下角改宽高，需要新增 resize 手柄，并持久化 `pos.width/height`。

---

## 11. 已知限制 / 待办

1. 新站原图走页面「下载图片」接口；接口失效时直接报错，不静默降级到 WebP 缩略图。
2. **只扫描当前已渲染的 DOM**；虚拟列表滚出即移除，不会预抓全量。
3. **跨域 iframe 不支持**；同源 iframe 和开放 Shadow DOM 支持。
4. **不是浏览器原生侧边栏**，是页面内浮层；切换标签页不跟随。
5. **QQ 未实机验证**；自定义目录、子目录下载、扩展加载方式可能因版本不同有差异。
6. **Firefox / Safari 未实现**。
7. 面板位置存的是像素值；换显示器/分辨率会做 clamp，但不会按比例缩放。
8. 没有 i18n，全部中文。
9. 没有下载失败重试按钮；失败只在 toast 里提示。
10. 生成中的卡片被完全跳过，列表中看不到。
11. 自定义保存目录需要 HTTPS + File System Access；不支持时只能回退下载目录。

---

## 12. 用户偏好（给后续 AI）

- 用中文沟通；结论先行，少铺垫。
- 用户是产品/业务侧，不是前端；解释“为什么”比堆代码重要。
- 不要过度设计；能用一个文件解决就别拆五个。
- 每次改完要给出**可验证的结果**（截图、测试数字、实际文件名）。
- 安装文档要“奶奶级”：大字号、编号步骤、每步一个动作、明确写出去哪里点什么。
- 文件名 = 素材名称，不要序号前缀。
- 只显示状态为「图片已生成」的素材。
- 不要离屏缓存。
- 面板要能拖动、记住位置。
- 保存位置要能自定义，不要只写浏览器下载目录。
- 重名默认跳过，不覆盖（可手动取消勾选）。
- 权限尽量小，只声明目标域名与图片 CDN。

---

## 13. 变更记录

### 2026-11-21 · v1.3.0

- 标题旁新增识别小 `i`：页面卡片数、有图数、已识别数、未识别图片名与原因。
- 底部计数与下载成功 toast 新增下载小 `i`：成功、跳过重名、失败数量与失败原因。
- 扫描统计 `scanStats` 增加分类计数；新增 `scanIssues` 与 `lastDownloadReport`。
- 状态文本清洗，避免把任务号/「下载图片」拼进失败原因。
- E2E 增加识别提示、成功提示、模拟 404 失败明细校验。

### 2026-11-21 · v1.2.0

- 新站下载改走原图接口 `.asset-image-status a[href*="/download/"]`，不再用 WebP 缩略图。
- 面板新增「原图」标签；缩略图仅预览。
- 原图获取失败直接报错，不静默降级。
- 内容脚本 `getAssetBlob` 优先 `downloadUrl`；后台 fetch 增加 60 秒超时与图片文件头校验。
- 演示服务器新增模拟原图接口；E2E 校验下载文件来自原图接口（2515 字节）。

### 2026-11-13 · v1.1.0

- 适配新站 `https://photo.colo14.top/`：新的卡片 DOM、状态校验、名称/图片选择器。
- 只抓「图片已生成」的卡片；`生成中` / 失败状态跳过。
- 新增自定义保存文件夹（File System Access API），目录 handle 持久化。
- 新增重名检查：默认跳过同名文件，可取消勾选改为覆盖。
- 新站图片改为跨域 HTTPS，新增后台 `fetch-image` 兜底与 CDN host 权限。
- 兼容旧站 `yinghuo.clouded.top` 的 blob 卡片。
- 更新演示页、E2E、安装教程、README 与版本文档。

### 2026-11-06 · v1.0.0

- 初始版本：MV3/MV2 双包、浮层面板、多选/全选/搜索/类型筛选。
- 支持 blob 图片、data URL 下载、文件夹子目录、中文文件名。
- 兼容两种 `data-asset`（`type:name` 与纯 ID）。
- 增加同源 iframe / Shadow DOM 深度扫描、未生图跳过。
- 删除命名方式下拉；文件名固定为素材名称。
- 去掉离屏缓存；随 DOM 实时裁剪列表与选中项。
- 标题栏拖动、位置持久化、双击复位、拖动时高度自适应。
- 安装教程 DOCX/PDF（含关闭「每次下载前询问保存位置」）。

---

## 14. 交接自检清单

接手后先确认：

- [ ] `node test/unit.mjs` 通过（12 项）。
- [ ] `node build.mjs` 能生成两个目录。
- [ ] `dist/qq-mv3/manifest.json` 包含 `photo.colo14.top`、`yinghuo.clouded.top` 和图片 CDN，权限没被误改。
- [ ] 面板只显示「图片已生成」的卡片，`生成中` / 失败状态不出现。
- [ ] 文件名是 `名称.png`，没有 `001_`。
- [ ] 面板行有「原图」标签；下载走 `/gateway/media/jobs/.../download/0`，不是 WebP 缩略图。
- [ ] 标题旁小 `i` 能看到页面卡片/已识别/未识别明细；下载后小 `i` 能看到成功/失败原因。
- [ ] 弹窗能「选择文件夹」；默认勾选「重名时跳过」。
- [ ] 重名文件会被跳过；取消勾选后能覆盖。
- [ ] 删掉页面卡片后，面板行数和已选数同步减少。
- [ ] 拖动标题栏能移动，双击能复位。
- [ ] 安装文档第 5 步仍然在讲「关闭每次下载询问保存位置」。

只要以上都对，就可以安全地继续改。
