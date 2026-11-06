# -*- coding: utf-8 -*-
from pathlib import Path

from docx import Document

root = Path(__file__).resolve().parents[1]
path = root / "docs" / "素材抓取插件-安装教程.docx"

doc = Document(path)
text = "\n".join(p.text for p in doc.paragraphs)
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            text += "\n" + cell.text

checks = [
    "qqbrowser://extensions",
    "开发者模式",
    "加载已解压的扩展程序",
    "下载设置",
    "每次下载前询问保存位置",
    "下载前询问每个文件的保存位置",
    "默认下载位置",
    "qq-mv3.zip",
]
for item in checks:
    print(("OK   " if item in text else "MISS ") + item)
print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))
