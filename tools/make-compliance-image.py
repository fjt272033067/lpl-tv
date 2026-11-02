# -*- coding: utf-8 -*-
"""make-compliance-image.py — 把「整改证据」两张截图合成一张带说明的图

输入（tools/capture-compliance.mjs 产出）：
    docs/申诉材料/06a-弹幕正常渲染.png
    docs/申诉材料/06b-页脚合规声明.png
输出：
    docs/申诉材料/06-整改证据.png

用法：py -3 tools/make-compliance-image.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', '申诉材料')
A = os.path.join(OUT, '06a-弹幕正常渲染.png')
B = os.path.join(OUT, '06b-页脚合规声明.png')
DST = os.path.join(OUT, '06-整改证据.png')

BG = (17, 20, 28)
FG = (232, 236, 244)
GOLD = (255, 194, 75)
DIM = (150, 158, 172)


def font(size):
    for name in ('msyh.ttc', 'msyhbd.ttc', 'simhei.ttf', 'simsun.ttc', 'arial.ttf'):
        p = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    ia, ib = Image.open(A), Image.open(B)
    w = 1200
    ha = int(ia.height * w / ia.width)
    hb = int(ib.height * w / ib.width)
    ia = ia.resize((w, ha), Image.LANCZOS)
    ib = ib.resize((w, hb), Image.LANCZOS)

    title_h, cap_h, pad = 92, 40, 22
    H = title_h + cap_h + ha + pad + cap_h + hb + pad
    canvas = Image.new('RGB', (w, H), BG)
    d = ImageDraw.Draw(canvas)

    f_title = font(34)
    f_cap = font(22)
    f_small = font(19)

    d.text((pad, 18), '整改后状态：弹幕含谩骂词整条不显示 · 页脚已加内容合规声明', font=f_title, fill=FG)
    d.text((pad, 60), '2026-11-02 ｜ LPL-TV（github.com/fjt272033067/lpl-tv）', font=f_small, fill=DIM)

    y = title_h
    d.text((pad, y), '① 弹幕正常渲染（无冻结残留、无叠字）', font=f_cap, fill=GOLD)
    y += cap_h
    canvas.paste(ia, (0, y))
    y += ha + pad
    d.text((pad, y), '② 页脚内容合规声明', font=f_cap, fill=GOLD)
    y += cap_h
    canvas.paste(ib, (0, y))

    canvas.save(DST)
    print('已生成：' + DST)


if __name__ == '__main__':
    main()
