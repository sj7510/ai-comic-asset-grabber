# 贡献说明

## 先读

- [AI开发交接文档](AI开发交接文档.md)：架构、决策、坑、测试方法。
- [README](README.md)：安装与目录结构。

## 环境

- Node.js >= 22（端到端测试用到内置 `WebSocket`）
- Windows 下验证浏览器：QQ 浏览器 / Chrome / Edge

## 提交前自检

```powershell
node test/unit.mjs
node build.mjs
```

改了扫描、选择、下载、拖动等交互，再跑：

```powershell
$env:CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:E2E_EXT_DIR = "dist/qq-mv2"
$env:E2E_HEADED = "1"
node test/e2e.mjs
```

## 约定

- 不引入运行时 npm 依赖；扩展保持原生 JS。
- 改站点选择器只改 `src/content.js` 顶部 `SITE`。
- 不删除 MV2 版本；老版 QQ 可能只认 MV2。
- 不改回「命名方式下拉」「未生图列表」「离屏缓存」这三个已被用户否决的行为。
- 不提交 `dist/`、`test/.tmp/`、测试生成的截图；发布包放 `release/`。
- 更新功能时同步更新 `README.md`、`CHANGELOG.md`、`AI开发交接文档.md`。
