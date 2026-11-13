# 漫剧素材抓取（AI Comic Asset Grabber）

一个跑在 Chromium 内核浏览器里的素材抓取扩展：扫描漫剧平台的资产卡片，在页面右侧面板里展示「图片 + 名称」，多选后按文件夹批量下载。

- 适配新平台 `https://photo.colo14.top/`，同时兼容旧的 `yinghuo.clouded.top`
- 适配 QQ 浏览器（极速模式）、Chrome、Edge
- 支持选择任意保存文件夹，下载前检查同名文件
- 不需要服务器，不上传数据，图片只在本机处理

## 功能

| 能力 | 说明 |
| --- | --- |
| 自动扫描 | 识别 `article.asset-card`，只挑状态为「图片已生成」的卡片 |
| 名称提取 | 取 `.asset-card-copy strong`，回退 `img[alt]`、选择框的 `aria-label` |
| 深度扫描 | 同源 iframe、开放 Shadow DOM 内的卡片也能扫到 |
| 多选 | 单击勾选、`Shift` 连选、全选 / 反选 / 清空 |
| 搜索与分类 | 按名称搜索，按类型筛选 |
| 自定义保存位置 | 「选择文件夹」可直接保存到任意路径，不经过浏览器下载目录 |
| 重名处理 | 默认「重名时跳过，不覆盖」；取消勾选则覆盖同名文件 |
| 批量下载 | 文件名直接使用素材名称，例如 `Emma Carter.png` |
| 可拖动 | 按住标题栏拖动，位置记忆；双击复位 |
| 实时同步 | 只显示当前 DOM 里的卡片；卡片移除后列表和选中状态一起移除 |
| 格式识别 | png / jpg / webp / gif / avif，按 MIME + 文件头判断 |

> 自定义保存位置使用浏览器的 File System Access API，需要 HTTPS 页面和 Chromium 内核；不选文件夹时仍可回退到浏览器下载目录。重名检查只在「已选择文件夹」时生效。

## 快速安装（非技术用户）

1. 下载 [release/qq-mv3.zip](release/qq-mv3.zip)
2. 右键解压到桌面，得到 `qq-mv3` 文件夹
3. QQ 浏览器地址栏打开 `qqbrowser://extensions`
4. 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `qq-mv3`
5. **浏览器设置 → 下载设置 → 取消勾选「每次下载前询问保存位置」**
6. 打开平台页面，刷新，右侧出现面板

> 图文版：[安装教程 Word](docs/素材抓取插件-安装教程.docx) ｜ [PDF](docs/素材抓取插件-安装教程.pdf)  
> 如果 QQ 提示「清单版本不支持」，改用 [release/qq-mv2.zip](release/qq-mv2.zip)。

> 只支持「极速模式」（Chromium 内核）；兼容模式（IE 内核）下扩展不会注入。

## 使用

1. 打开 `https://photo.colo14.top/`，进入资产库，刷新页面
2. 右侧面板会自动出现（没有就点工具栏插件图标）
3. 勾选状态为「图片已生成」的素材，或点「全选」
4. 点「下载」
5. 推荐点「选择文件夹」选一个保存位置；不选则使用浏览器下载目录 + 文件夹名
6. 「重名时跳过，不覆盖」默认勾选；需要覆盖同名文件时取消勾选
7. 点「开始下载」

面板只展示当前已渲染的卡片；滚动加载的新卡片会自动加入，滚出 DOM 的会被移除。

## 开发

要求 Node.js >= 22（E2E 使用内置 `WebSocket`）。

```bash
node test/unit.mjs     # 12 项纯逻辑单测
node build.mjs         # 生成 dist/qq-mv3 和 dist/qq-mv2
```

端到端测试（无 Playwright 依赖，直接用 CDP）：

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:E2E_EXT_DIR = "dist/qq-mv3"
node test/e2e.mjs
```

> 当前 E2E 使用新站点的演示 DOM（`photo.colo14.top`）。Chrome 137+ 正式版禁用了命令行加载未打包扩展，自动测试请用 Chrome for Testing 或 Edge；手动「加载已解压」不受影响。

### 目录

```
src/                 扩展源码（lib / content / background / 两份 manifest）
demo/                本地演示页与 127.0.0.1:6912 静态服务器（新站点 DOM）
test/                单测 + CDP 端到端测试
tools/               图标生成、安装文档生成脚本
docs/                安装教程 DOCX / PDF
release/             可直接分发的 zip
build.mjs            构建脚本（无依赖）
```

### 发布包

`build.mjs` 只生成 `dist/`，不会打 zip。发布时：

```powershell
Compress-Archive -Path "dist\qq-mv3\*" -DestinationPath "release\qq-mv3.zip" -Force
Compress-Archive -Path "dist\qq-mv2\*" -DestinationPath "release\qq-mv2.zip" -Force
```

zip 根目录必须直接包含 `manifest.json`。

## 已知限制

- 自定义保存位置依赖 File System Access API：需要 HTTPS 页面 + Chromium 内核；不选文件夹时回退到浏览器下载目录。
- 「重名跳过」只在选择了文件夹后生效；默认下载目录模式无法扫描已有文件，浏览器会自动加 `(1)`。
- 只扫描状态为「图片已生成」且已渲染到 DOM 的卡片，不支持预抓虚拟列表全量。
- 跨域 iframe 不支持（同源 iframe 支持）。
- 不是浏览器原生侧边栏，是页面内浮层，切换标签页不跟随。
- 图片来自 `video-gen-uploads.tos-cn-beijing.volces.com`；如果平台更换 CDN，需要同步更新 manifest 的 host 权限。
- QQ 浏览器未实机验证；如遇问题请附上 QQ 版本与页面截图。
- Firefox / Safari 未实现。

## 文档

- [AI 开发交接文档](AI开发交接文档.md)：架构、决策、坑、测试与修改指南（交给 AI Agent 前先读）
- [安装教程 DOCX](docs/素材抓取插件-安装教程.docx) / [PDF](docs/素材抓取插件-安装教程.pdf)
- [更新日志](CHANGELOG.md) ｜ [贡献说明](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE) © 2026 sj7510

