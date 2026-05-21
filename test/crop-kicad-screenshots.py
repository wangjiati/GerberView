"""
裁剪 KiCad 截图到 canvas 区域 (去掉工具栏和状态栏)

KiCad GerbView 窗口布局 (3797x2052 at 2x DPI):
  - 工具栏: y=0~108
  - 画布:   y=108~1959
  - 状态栏: y=1959~2052
"""

import os
import sys
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

KICAD_DIR = r'D:\projects\gerbview\test\screenshots\kicad'
OUTPUT_DIR = r'D:\projects\gerbview\test\screenshots\kicad_cropped'

# 固定裁剪区域 (通过亮度跳变分析确定)
CROP_TOP = 108
CROP_BOTTOM = 1959


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    files = [f for f in os.listdir(KICAD_DIR) if f.endswith('.png')]
    print(f"找到 {len(files)} 个 KiCad 截图")

    for fname in sorted(files):
        path = os.path.join(KICAD_DIR, fname)
        img = Image.open(path)
        w, h = img.size

        # 确保边界在图片范围内
        top = min(CROP_TOP, h)
        bottom = min(CROP_BOTTOM, h)

        cropped = img.crop((0, top, w, bottom))
        outpath = os.path.join(OUTPUT_DIR, fname)
        cropped.save(outpath)

    print(f"已裁剪 {len(files)} 个截图到 {OUTPUT_DIR}")
    print(f"裁剪区域: (0, {CROP_TOP}, {3797 if files else 0}, {CROP_BOTTOM})")


if __name__ == '__main__':
    main()
