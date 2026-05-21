"""
KiCad GerbView 自动截图脚本
用 pywinauto 启动 gerbview.exe，逐文件加载、Zoom Fit、截图
"""

import os
import sys
import time
import argparse

sys.stdout.reconfigure(encoding='utf-8')

from PIL import Image, ImageGrab
from pywinauto import Application, Desktop


KICAD_GERBVIEW = r"C:\Users\win11\AppData\Local\Programs\KiCad\10.0\bin\gerbview.exe"
GERBER_EXTS = {
    '.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo',
    '.gko', '.gm1', '.gm2', '.gm3', '.gpb', '.gpt', '.drl', '.xnc',
    '.xln', '.drd', '.gdl', '.gdr',
}


def find_gerber_files(root_dir, max_files=0):
    files = []
    for dirpath, _, filenames in os.walk(root_dir):
        for f in filenames:
            if os.path.splitext(f)[1].lower() in GERBER_EXTS:
                files.append(os.path.join(dirpath, f))
    files.sort()
    return files[:max_files] if max_files > 0 else files


def safe_filename(name):
    return name.replace(' ', '_').replace('$', 'S').replace('#', 'H')[:80]


def wait_for_gerbview(timeout=15):
    desktop = Desktop(backend='uia')
    deadline = time.time() + timeout
    while time.time() < deadline:
        for w in desktop.windows():
            if w.element_info.class_name == 'wxWindowNR' and 'Gerber' in w.window_text():
                return w
        time.sleep(1)
    return None


def capture_file(filepath, output_dir, crop_toolbar=True):
    """启动 GerbView 加载单个文件，截图保存"""
    basename = os.path.splitext(os.path.basename(filepath))[0]
    outname = safe_filename(basename) + '.png'
    outpath = os.path.join(output_dir, outname)

    if os.path.exists(outpath):
        print(f"  跳过(已存在): {outname}")
        return outpath

    print(f"  处理: {os.path.basename(filepath)}")

    try:
        app = Application(backend='uia').start(f'"{KICAD_GERBVIEW}" "{filepath}"')
    except Exception as e:
        print(f"  启动失败: {e}")
        return None

    win = wait_for_gerbview()
    if not win:
        print("  找不到 GerbView 窗口")
        try: app.kill()
        except: pass
        return None

    try:
        win.maximize()
        time.sleep(1.5)
        win.set_focus()
        time.sleep(0.3)
        win.type_keys('{HOME}', pause=0.1)
        time.sleep(1.5)

        rect = win.rectangle()
        img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))

        if crop_toolbar:
            # KiCad GerbView 布局分析:
            #   顶部: 标题栏(0~13) + 菜单栏(13~42) + 工具栏(42~57)
            #   左侧: 图标工具栏(0~64)
            #   画布: 从 (65, 58) 开始到右下角
            w, h = img.size
            img = img.crop((65, 58, w, h))

        img.save(outpath)
        print(f"  保存: {outname} ({img.size[0]}x{img.size[1]})")
        return outpath
    except Exception as e:
        print(f"  失败: {e}")
        return None
    finally:
        try: app.kill()
        except: pass
        time.sleep(0.5)


def capture_project(project_dir, files, output_dir):
    """加载一个项目的所有文件到同一个窗口，截图每层"""
    project_name = safe_filename(os.path.basename(project_dir))

    for i, f in enumerate(files):
        basename = os.path.splitext(os.path.basename(f))[0]
        layer_name = f"L{i:02d}_{safe_filename(basename)}"
        outname = f"{project_name}__{layer_name}.png"
        outpath = os.path.join(output_dir, outname)

        if os.path.exists(outpath):
            print(f"  跳过(已存在): {outname}")
            continue

        print(f"  处理: [{i+1}/{len(files)}] {os.path.basename(f)}")

        try:
            app = Application(backend='uia').start(f'"{KICAD_GERBVIEW}" "{f}"')
        except Exception as e:
            print(f"  启动失败: {e}")
            continue

        win = wait_for_gerbview()
        if not win:
            print("  找不到窗口")
            try: app.kill()
            except: pass
            continue

        try:
            win.maximize()
            time.sleep(1.5)
            win.set_focus()
            time.sleep(0.3)

            # Zoom Fit
            win.type_keys('{HOME}', pause=0.1)
            time.sleep(1.5)

            rect = win.rectangle()
            img = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom))

            # 裁剪工具栏
            w, h = img.size
            img = img.crop((48, 90, w, h))

            img.save(outpath)
            print(f"  保存: {outname}")
        except Exception as e:
            print(f"  失败: {e}")
        finally:
            try: app.kill()
            except: pass
            time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(description='KiCad GerbView 批量截图')
    parser.add_argument('--test-dir', default=r'D:\projects\gerbview\docs\test-files')
    parser.add_argument('--output-dir', default=r'D:\projects\gerbview\test\screenshots\kicad')
    parser.add_argument('--max-files', type=int, default=0, help='最大文件数 (0=全部)')
    parser.add_argument('--single', type=str, default=None, help='单个文件路径')
    parser.add_argument('--no-crop', action='store_true', help='不裁剪工具栏')
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    if args.single:
        capture_file(args.single, args.output_dir, crop_toolbar=not args.no_crop)
        return

    files = find_gerber_files(args.test_dir, args.max_files)
    print(f"找到 {len(files)} 个 Gerber 文件")

    for f in files:
        capture_file(f, args.output_dir, crop_toolbar=not args.no_crop)

    print("完成")


if __name__ == '__main__':
    main()
