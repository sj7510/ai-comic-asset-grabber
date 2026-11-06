# -*- coding: utf-8 -*-
"""Generate a very simple, large-print install guide for the AssetGrab extension."""
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

OUT = Path(__file__).resolve().parents[1] / "docs" / "素材抓取插件-安装教程.docx"

FONT = "微软雅黑"
PURPLE = RGBColor(0x5B, 0x21, 0xB6)
DARK = RGBColor(0x1F, 0x29, 0x37)
GRAY = RGBColor(0x6B, 0x72, 0x80)
ORANGE = RGBColor(0xB4, 0x53, 0x09)
GREEN = RGBColor(0x16, 0x65, 0x34)


def set_font(run, size=12, bold=False, color=DARK, italic=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), FONT)
    rfonts.set(qn("w:ascii"), FONT)
    rfonts.set(qn("w:hAnsi"), FONT)


def para(container, text="", size=12, bold=False, color=DARK, space_after=4,
         space_before=0, align=None, line=1.35, italic=False):
    p = container.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = line
    if align is not None:
        p.alignment = align
    if text:
        set_font(p.add_run(text), size, bold, color, italic)
    return p


def rich(container, parts, size=12, space_after=3, indent=None, line=1.35):
    """parts: list of (text, bold, color) tuples."""
    p = container.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = line
    if indent is not None:
        p.paragraph_format.left_indent = Cm(indent)
    for text, bold, color in parts:
        set_font(p.add_run(text), size, bold, color)
    return p


def bullet(container, text, size=11.5, bold_prefix=None, space_after=3):
    p = container.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.3
    if bold_prefix and text.startswith(bold_prefix):
        set_font(p.add_run(bold_prefix), size, True, DARK)
        set_font(p.add_run(text[len(bold_prefix):]), size, False, DARK)
    else:
        set_font(p.add_run(text), size, False, DARK)
    return p


def step(doc, number, title, color=PURPLE):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(13)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    set_font(p.add_run("第 %d 步  " % number), 16.5, True, color)
    set_font(p.add_run(title), 16.5, True, DARK)

    ppr = p._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "2")
    bottom.set(qn("w:color"), "DDD6FE")
    borders.append(bottom)
    ppr.append(borders)
    return p


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def set_cell_margins(cell, top=100, bottom=100, left=160, right=160):
    tcpr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for name, value in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        el = OxmlElement("w:" + name)
        el.set(qn("w:w"), str(value))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tcpr.append(mar)


def box(doc, lines, fill="EEF2FF", width=17.0):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Cm(width)
    cell = table.cell(0, 0)
    cell.width = Cm(width)
    shade(cell, fill)
    set_cell_margins(cell)
    # keep the box on one page
    trpr = table.rows[0]._tr.get_or_add_trPr()
    cant = OxmlElement("w:cantSplit")
    trpr.append(cant)

    first = True
    for item in lines:
        if isinstance(item, str):
            p = cell.paragraphs[0] if first else cell.add_paragraph()
            set_font(p.add_run(item), 11.5, False, DARK)
        else:
            text, bold, color = item
            p = cell.paragraphs[0] if first else cell.add_paragraph()
            set_font(p.add_run(text), 11.5, bold, color)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.3
        first = False
    return table


def main():
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    # title
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run("漫剧素材抓取插件 · 安装教程"), 23, True, PURPLE)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run("照着做，3 分钟就能装好（QQ 浏览器）"), 12, False, GRAY)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(10)
    set_font(p.add_run("适用：Windows 电脑 + QQ 浏览器     |     安装包：qq-mv3.zip"), 10.5, False, GRAY)

    # preparation
    para(doc, "开始前，请先准备好", 13, True, DARK, space_before=4, space_after=4)
    box(doc, [
        ("□  一台 Windows 电脑，已经装好 QQ 浏览器", False, DARK),
        ("□  拿到安装包 qq-mv3.zip（先放在桌面）", False, DARK),
        ("□  平台网址：http://yinghuo.clouded.top:6912", False, DARK),
    ], fill="EEF2FF")

    # steps
    step(doc, 1, "先把安装包解压")
    bullet(doc, "在桌面上找到 qq-mv3.zip。")
    bullet(doc, "右键点它，选「全部解压缩」，再点「确定」。")
    bullet(doc, "桌面会多出一个文件夹，名字叫 qq-mv3。打开能看到 manifest.json 就对了。")
    rich(doc, [("注意：", True, ORANGE), ("不要直接在压缩包里点，要先解压出来。", False, DARK)],
         11, indent=0.6, space_after=0)

    step(doc, 2, "打开浏览器的扩展管理页")
    bullet(doc, "打开 QQ 浏览器。")
    bullet(doc, "在最上面的地址栏输入：qqbrowser://extensions 然后按回车。")
    bullet(doc, "会看到一个「扩展程序」页面。")

    step(doc, 3, "打开「开发者模式」")
    bullet(doc, "在页面右上角找到「开发者模式」。")
    bullet(doc, "把开关打开（变成蓝色）。")
    bullet(doc, "打开后，页面上会出现「加载已解压的扩展程序」按钮。")
    para(doc, "做到这里先别关浏览器，翻到下一页继续装。", 10.5, False, GRAY,
         space_before=10, align=WD_ALIGN_PARAGRAPH.CENTER, italic=True)

    doc.add_page_break()
    step(doc, 4, "把插件装进去")
    bullet(doc, "点「加载已解压的扩展程序」。")
    bullet(doc, "在弹出的窗口里，选中桌面上的 qq-mv3 文件夹。")
    bullet(doc, "点「选择文件夹」。")
    bullet(doc, "列表里出现「漫剧素材抓取」，就说明装好了。")
    bullet(doc, "关掉这个页面。")

    step(doc, 5, "关闭「每次下载都询问保存位置」（最重要）", color=ORANGE)
    bullet(doc, "点 QQ 浏览器右上角的「☰」菜单，点「设置」。")
    bullet(doc, "点左边的「下载设置」；找不到就在地址栏输入 qqbrowser://settings 回车再找。")
    bullet(doc, "找到「每次下载前询问保存位置」（有的版本叫「下载前询问每个文件的保存位置」），把它前面的勾去掉。")
    bullet(doc, "顺便看一下「默认下载位置」，记住这个文件夹（一般是「下载」）。")
    bullet(doc, "关掉设置页。")
    box(doc, [
        ("为什么一定要关？", True, ORANGE),
        ("插件一次会下载很多张图。不关这个设置，浏览器会一张一张弹窗问你存哪里，点到手软。", False, DARK),
        ("关掉后，所有图会自动放进你输入的那个文件夹。", True, GREEN),
    ], fill="FFF7E6")

    step(doc, 6, "打开平台页面")
    bullet(doc, "在 QQ 浏览器打开：http://yinghuo.clouded.top:6912")
    bullet(doc, "登录你的账号。")
    bullet(doc, "进入「角色资产」页面。")
    bullet(doc, "按一下 F5 刷新页面。")
    bullet(doc, "页面右侧出现「素材抓取」面板，就成功了。")
    rich(doc, [("小提示：", True, PURPLE), ("如果面板没出现，点浏览器右上角工具栏里的插件图标。", False, DARK)],
         11, indent=0.6, space_after=0)
    para(doc, "装好之后，翻到下一页看怎么下载素材。", 10.5, False, GRAY,
         space_before=10, align=WD_ALIGN_PARAGRAPH.CENTER, italic=True)

    doc.add_page_break()
    step(doc, 7, "开始下载素材")
    bullet(doc, "在面板里勾选要的图片，或者点「全选」。")
    bullet(doc, "点底部的「下载」。")
    bullet(doc, "输入文件夹名字，比如：第一集角色。")
    bullet(doc, "点「开始下载」。")
    bullet(doc, "打开「下载」文件夹，就能看到「第一集角色」文件夹。")

    # FAQ
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(4)
    set_font(p.add_run("装的时候卡住了？看这里"), 15, True, PURPLE)

    faqs = [
        ("面板没有出来？", "先按 F5 刷新页面；再点浏览器右上角工具栏里的插件图标；确认页面是「极速模式」，不是「兼容模式」。"),
        ("提示「清单版本不支持」？", "改用 qq-mv2.zip，从第 1 步到第 4 步再装一次。"),
        ("点了下载没反应？", "回到第 5 步，确认「每次下载前询问保存位置」已经关闭，然后重新勾选再下载。"),
        ("下载的图在哪？", "QQ 浏览器「设置」→「下载设置」→「默认下载位置」。"),
        ("换一台电脑怎么办？", "把 qq-mv3.zip 拷到新电脑，按这份教程再装一次。"),
    ]
    for q, a in faqs:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(1)
        set_font(p.add_run("问：" + q), 11.5, True, DARK)
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.3
        set_font(p.add_run("答：" + a), 11, False, GRAY)

    # Chrome/Edge note
    box(doc, [
        ("用 Chrome 或 Edge 的话，也要关这个设置：", True, DARK),
        ("Chrome：设置 → 下载内容 → 关闭「下载前询问每个文件的保存位置」", False, DARK),
        ("Edge：设置 → 下载 → 关闭「每次下载都询问我该保存什么位置」", False, DARK),
    ], fill="F3F4F6")

    # footer
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run("插件只对 yinghuo.clouded.top 这个网站生效，打开别的网站不会出现面板。"), 9.5, False, GRAY)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.core_properties.title = "漫剧素材抓取插件安装教程"
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
