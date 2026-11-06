# 漫剧素材抓取插件 · AI 开发交接文档

> 最后更新：2026-11-06  
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
8. 交互文案用中文，安装文档要写到非技术人员能照着点。

---

## 1. 项目是什么

一个浏览器扩展（Chrome 内核），在「漫剧平台」的资产库页面右侧注入一个浮层面板：

- 自动扫描页面里的素材卡片（图片 + 名称）；
- 列表展示缩略图、名称、类型、分辨率；
- 支持多选、Shift 连选、全选 / 反选 / 清空、搜索、按类型筛选；
- 点「下载」弹窗输入文件夹名，把选中的图片批量下载到浏览器下载目录下的同名文件夹；
- 面板可拖动，位置会记住；
- 只显示当前页面 DOM 里「已生成」的素材。

目标平台：

```
http://yinghuo.clouded.top:6912
```

扩展只对这个域名（含任意端口）注入，其它网站不生效。

---

## 2. 用户需求演进（重要决策记录）

| 阶段 | 用户要求 | 最终实现 |
| --- | --- | --- |
| 最初 | 抓页面图片和名称，侧边栏多选，输入文件夹名下载 | 页面右侧浮层面板 + data URL 下载 |
| 平台 | 优先 QQ 浏览器，其次主流浏览器 | Chromium 优先；MV3 + MV2 双包 |
| DOM 变化 | `data-asset` 从 `character:名称` 变成纯 ID `u179...` | 名称改为优先读 `<strong>`，其次 `img[alt]` |
| 扫描失败 | 面板显示 0 | 支持同源 iframe、开放 Shadow DOM 深度扫描；未生图跳过 |
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
  "http://yinghuo.clouded.top/*",
  "https://yinghuo.clouded.top/*"
]
```

MV2 使用 `"permissions"` 直接包含域名，背景页为 `background.scripts`。

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
│   ├── index.html             # 本地演示页，模拟 18 个卡片（17 有图 + 1 未生图）
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

## 5. 真实站点 DOM（两种形态都要兼容）

### 形态 A：带类型前缀

```html
<article class="asset-card" data-asset="character:大胤前军·绯黑前军甲">
  ...
  <strong>大胤前军·绯黑前军甲</strong>
  <em>已生成</em>
</article>
```

### 形态 B：纯 ID（后来改成这样）

```html
<article class="asset-card" data-asset="u1793949188727">
  <input class="asset-check" type="checkbox" data-check="u1793949188727">
  <div class="asset-shot is-done">
    <span class="media-slot is-media-ready">
      <em class="media-loading" hidden>加载中</em>
      <img alt="户部侍郎顾怀章（主要反派）"
           data-cache="ast_01M6QV8KC73E351E37B99F|640"
           loading="lazy" decoding="async" referrerpolicy="no-referrer"
           src="blob:http://yinghuo.clouded.top:6912/dc1c0553-...">
    </span>
    <button class="asset-optimize">优化</button>
    <button class="asset-download">下载</button>
  </div>
  <strong>户部侍郎顾怀章（主要反派）</strong>
  <em>已生成</em>
</article>
```

### 扫描规则

```js
var SITE = {
  card: 'article.asset-card',
  media: '.media-slot img',
  image: 'img',
  name: ':scope > strong'
};
```

- 卡片：`article.asset-card`（**不要求** `data-asset` 含冒号）。
- key：`data-asset` → 没有则 `data-key` → 没有则 `auto:名称:序号`。
- 名称优先级：`<strong>` 文本 → `img[alt]` → `data-asset` 解析结果。
- 图片优先级：`currentSrc` → `src` → `data-src` → `data-original`。
- 没有 `src` 的卡片（未生图）直接跳过。
- 名称里的全角括号、`·` 原样保留。

### 为什么图片是 `blob:`

平台把图片缓存在页面里，`src` 是 `blob:http://yinghuo.clouded.top:6912/...`。这种地址：

- 只在页面存活期间有效，卡片被移除/页面刷新后可能失效；
- 必须在页面上下文 `fetch()` 取字节，不能直接丢给 `chrome.downloads`；
- 因此下载时先 `fetch` → `FileReader` 转 data URL → 发消息给后台。

### 画质限制

DOM 里 `data-cache` 是 `...|640`，说明页面渲染的是 **640 宽预览图**。插件抓的就是这张预览图，不是平台原图。若以后平台提供原图接口，需要改 `scanPage()` 的 `src` 取值或 `getAssetBlob()`。

---

## 6. 数据流与关键机制

```
页面 DOM
  │  scanPage()（每 500ms 前 60 秒 + MutationObserver）
  ▼
state.assets[] ──► render() ──► Shadow DOM 面板
  │                                │
  │ 勾选                           │ 输入文件夹名
  ▼                                ▼
state.selected(Set)           runDownload()
                                   │ getAssetBlob() → fetch(blob)
                                   │ blobToDataUrl()
                                   ▼
                     chrome.runtime.sendMessage({type:'assetgrab:download', item})
                                   ▼
                     background.downloadItem()
                                   ▼
              chrome.downloads.download({filename: '文件夹/名称.png'})
```

### 关键存储

| Key | 位置 | 内容 |
| --- | --- | --- |
| `assetgrab:settings` | `chrome.storage.local` | `{ folder, pattern:'name', autoOpen, pos:{left,top,width,height} }` |
| `assetgrab:closed` | `sessionStorage` | 当前标签页关过面板，避免自动弹出 |

### 消息

| type | 方向 | 作用 |
| --- | --- | --- |
| `assetgrab:ping` | 后台 → 内容脚本 | 判断页面是否已注入 |
| `assetgrab:toggle` | 后台 → 内容脚本 | 打开/关闭面板 |
| `assetgrab:download` | 内容脚本 → 后台 | 下载单张图 |
| `assetgrab:download-check` | 调试用 | 查询最近下载 |

### 下载细节

- 文件名：`sanitizeFilename(名称)` + 扩展名，**没有序号前缀**。
- 扩展名：MIME → 文件头 sniff → 兜底 `png`。
- `conflictAction: 'uniquify'`，重名自动加 `(1)`。
- 每张间隔约 60ms，避免瞬间大量下载。
- 单张 fetch 超时 20 秒；失败不影响其它图片。
- 若 `fetch(blob)` 失败，回退到把 `<img>` 画进 canvas 导出 PNG。
- 若返回 `text/html` / `application/json`，视为失败，避免把登录页存成图片。

---

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
- 用 `--host-resolver-rules=MAP yinghuo.clouded.top 127.0.0.1` 让演示页命中真实 host 权限
- 加载 `dist/qq-mv3` 或 `dist/qq-mv2`
- 验证：18 个卡片 → 面板 17 行（跳过 1 个未生图）→ 搜索 1 行 → Shift 连选 5 个 → 全选 17 → 下载 17 个文件 → 文件名 `大胤前军·绯黑前军甲.png`
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

测试会写 `test/.tmp/`（profile、下载目录、chrome.log），`test/` 下还会生成 `panel.png`、`panel-selected.png`、`panel-dialog.png`。这些是临时产物，可删。

Chrome for Testing 可以用镜像下载：

```
https://cdn.npmmirror.com/binaries/chrome-for-testing/<version>/win64/chrome-win64.zip
```

（本机曾用 157.0.8103.38 验证 MV3；下载后不需要提交进仓库。）

### 已验证环境

- Chrome for Testing 157 + `dist/qq-mv3`：早期版本下载、命名、文件夹校验通过。
- Edge 92 + `dist/qq-mv2`：17/17 下载通过；删除卡片同步；拖动通过（最新的离屏裁剪 / 拖动改动在 MV2 上复测，content.js 与 MV3 共用）。
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

1. **只有 640 宽预览图**，不是平台原图。需要原图接口。
2. **只扫描当前已渲染的 DOM**；虚拟列表滚出即移除，不会预抓全量。
3. **跨域 iframe 不支持**；同源 iframe 和开放 Shadow DOM 支持。
4. **不是浏览器原生侧边栏**，是页面内浮层；切换标签页不跟随。
5. **QQ 未实机验证**；子目录下载、扩展加载方式可能因版本不同有差异。
6. **Firefox / Safari 未实现**。
7. 面板位置存的是像素值；换显示器/分辨率会做 clamp，但不会按比例缩放。
8. 没有 i18n，全部中文。
9. 没有下载失败重试按钮；失败只在 toast 里提示。
10. 未生图卡片被完全跳过，列表中看不到。

---

## 12. 用户偏好（给后续 AI）

- 用中文沟通；结论先行，少铺垫。
- 用户是产品/业务侧，不是前端；解释“为什么”比堆代码重要。
- 不要过度设计；能用一个文件解决就别拆五个。
- 每次改完要给出**可验证的结果**（截图、测试数字、实际文件名）。
- 安装文档要“奶奶级”：大字号、编号步骤、每步一个动作、明确写出去哪里点什么。
- 文件名 = 素材名称，不要序号前缀。
- 只显示有图素材。
- 不要离屏缓存。
- 面板要能拖动、记住位置。
- 权限尽量小，只声明目标域名。

---

## 13. 变更记录

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
- [ ] `dist/qq-mv3/manifest.json` 的域名、权限没被误改。
- [ ] 面板只显示有图卡片，没有「未生图」。
- [ ] 文件名是 `名称.png`，没有 `001_`。
- [ ] 删掉页面卡片后，面板行数和已选数同步减少。
- [ ] 拖动标题栏能移动，双击能复位。
- [ ] 安装文档第 5 步仍然在讲「关闭每次下载询问保存位置」。

只要以上都对，就可以安全地继续改。
