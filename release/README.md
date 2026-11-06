# 发布包

| 文件 | 用途 |
| --- | --- |
| `qq-mv3.zip` | **优先使用**：Chrome / Edge / 新版 QQ 浏览器（Manifest V3） |
| `qq-mv2.zip` | 老版 QQ 浏览器不支持 MV3 时使用（Manifest V2） |

## 安装

1. 解压对应的 zip，得到 `qq-mv3` 或 `qq-mv2` 文件夹。
2. 浏览器打开 `qqbrowser://extensions`（Chrome 为 `chrome://extensions`）。
3. 打开「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的文件夹。
4. 浏览器设置 → 下载设置 → 关闭「每次下载前询问保存位置」。

详细图文：[安装教程](../docs/素材抓取插件-安装教程.pdf)

## 校验

`SHA256SUMS.txt` 记录了 zip 的 SHA-256；更新发布包时同步更新。
