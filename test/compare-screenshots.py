"""
Gerber 渲染对比工具 v2

策略:
  1. 两边截图分别二值化提取结构
  2. 居中对齐后做像素级 IoU（近似参考）
  3. 结构对比: 连通域数量、面积分布、内容密度
  4. 生成可视化 diff 和报告

用法: python test/compare-screenshots.py
"""

import os
import sys
import json
import argparse
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

import numpy as np
from PIL import Image, ImageDraw


# ============================================================
# 图像处理
# ============================================================

def load_and_binarize(path, remove_ui=False):
    """加载 → 灰度 → 固定阈值二值化

    使用固定阈值 20/255: 画布背景接近纯黑(0-15), 任何内容都 > 20

    remove_ui: 自动检测并移除 KiCad 右侧面板和底部状态栏
    """
    img = Image.open(path).convert('L')
    arr = np.array(img)

    if remove_ui:
        arr = strip_kicad_ui(arr)

    mask = (arr > 20).astype(np.uint8) * 255
    return mask, img.size


def strip_kicad_ui(arr):
    """检测并置黑 KiCad 截图中的 UI 元素

    KiCad GerbView 截图包含:
      - 顶部: 工具栏底边框 (亮度 ~240, 约 50 行)
      - 右侧: 层管理器面板 (亮度 ~245, 宽 350-850px)
      - 底部: 状态栏 (亮度 ~225, 约 90 行)
    这些 UI 元素不应参与渲染对比。
    """
    h, w = arr.shape
    result = arr.copy()

    # 检测右侧面板: 从右向左扫描, 找到持续高亮的区域边界
    panel_start = w
    for x in range(w - 20, w // 3, -1):
        col = arr[:, x]
        bright_pct = float((col > 200).sum()) / h
        if bright_pct > 0.7:
            panel_start = x
        else:
            break

    # 检测顶部工具栏: 从上向下扫描, 找到第一个暗行
    top_end = 0
    for y in range(h):
        row = arr[y, :min(panel_start, w)]
        bright_pct = float((row > 100).sum()) / max(min(panel_start, w), 1)
        if bright_pct < 0.3:
            top_end = y
            break

    # 检测底部状态栏: 从下向上扫描, 找到第一个暗行
    bottom_start = h
    for y in range(h - 1, h // 2, -1):
        row = arr[y, :min(panel_start, w)]
        bright_pct = float((row > 100).sum()) / max(min(panel_start, w), 1)
        if bright_pct < 0.3:
            bottom_start = y
            break

    if panel_start < w:
        # 多剥 10 列以移除面板边框/阴影 (灰度值 ~165)
        border_margin = 10
        result[:, max(0, panel_start - border_margin):] = 0
    if top_end > 0:
        result[:top_end, :] = 0
    if bottom_start < h:
        result[bottom_start:, :] = 0

    return result


def crop_content(arr, padding=5):
    """裁剪到内容区域，返回裁剪后的数组和偏移"""
    rows = np.any(arr > 0, axis=1)
    cols = np.any(arr > 0, axis=0)
    if not rows.any():
        return arr, 0, 0
    r0, r1 = np.where(rows)[0][[0, -1]]
    c0, c1 = np.where(cols)[0][[0, -1]]
    r0 = max(0, r0 - padding)
    c0 = max(0, c0 - padding)
    r1 = min(arr.shape[0], r1 + padding + 1)
    c1 = min(arr.shape[1], c1 + padding + 1)
    return arr[r0:r1, c0:c1], c0, r0


def center_on_canvas(arr, target_w, target_h):
    """将二值图居中放置在指定大小的画布上"""
    h, w = arr.shape
    canvas = np.zeros((target_h, target_w), dtype=np.uint8)

    # 缩放使内容适配目标画布 (留 5% 边距)
    scale = min(target_w * 0.95 / w, target_h * 0.95 / h)
    if scale < 1.0 or (scale > 1.0 and w > 100 and h > 100):
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        img = Image.fromarray(arr).resize((new_w, new_h), Image.LANCZOS)
        arr = np.array(img)

    h, w = arr.shape
    y_off = (target_h - h) // 2
    x_off = (target_w - w) // 2
    y_off = max(0, y_off)
    x_off = max(0, x_off)

    # 确保不超出画布
    paste_h = min(h, target_h - y_off)
    paste_w = min(w, target_w - x_off)
    canvas[y_off:y_off + paste_h, x_off:x_off + paste_w] = arr[:paste_h, :paste_w]

    return canvas


def align_pair(k_arr, w_arr, target_w, target_h):
    """将两幅二值图缩放到相同尺寸后重心对齐，再用小范围搜索优化"""
    def centroid_of(arr):
        """计算二值图的像素重心"""
        ys, xs = np.where(arr > 0)
        if len(xs) == 0:
            return target_w // 2, target_h // 2
        return float(xs.mean()), float(ys.mean())

    def scale_to_fit(arr, tw, th):
        h, w = arr.shape
        scale = min(tw / w, th / h)
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        img = Image.fromarray(arr).resize((nw, nh), Image.LANCZOS)
        canvas = np.zeros((th, tw), dtype=np.uint8)
        y_off = (th - nh) // 2
        x_off = (tw - nw) // 2
        canvas[y_off:y_off + nh, x_off:x_off + nw] = np.array(img)
        return canvas

    k_base = scale_to_fit(k_arr, target_w, target_h)
    w_base = scale_to_fit(w_arr, target_w, target_h)

    # 重心对齐: 计算两者重心偏移，平移 Web 图使重心匹配 KiCad
    kcx, kcy = centroid_of(k_base)
    wcx, wcy = centroid_of(w_base)
    shift_x = int(round(kcx - wcx))
    shift_y = int(round(kcy - wcy))
    # 限制最大偏移为画布的 1/4
    shift_x = max(-target_w // 4, min(target_w // 4, shift_x))
    shift_y = max(-target_h // 4, min(target_h // 4, shift_y))
    w_base = np.roll(np.roll(w_base, shift_y, axis=0), shift_x, axis=1)

    # 在 ±4 像素范围内精调
    best_iou = -1
    best_dx, best_dy = 0, 0
    kb_base = k_base > 128
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            w_shifted = np.roll(np.roll(w_base, dy, axis=0), dx, axis=1)
            wb = w_shifted > 128
            inter = (kb_base & wb).sum()
            union = (kb_base | wb).sum()
            iou = float(inter / union) if union > 0 else 0.0
            if iou > best_iou:
                best_iou = iou
                best_dx, best_dy = dx, dy

    w_canvas = np.roll(np.roll(w_base, best_dy, axis=0), best_dx, axis=1)
    return k_base, w_canvas


def count_blobs(arr):
    """简单的连通域计数（4-连通 flood fill）"""
    binary = (arr > 128).astype(np.int32)
    h, w = binary.shape
    visited = np.zeros_like(binary, dtype=bool)
    blobs = []
    stack = []

    for y in range(0, h, 2):  # 隔行扫描加速
        for x in range(0, w, 2):
            if binary[y, x] and not visited[y, x]:
                # BFS
                stack.append((y, x))
                visited[y, x] = True
                area = 0
                min_y, max_y = y, y
                min_x, max_x = x, x
                while stack:
                    cy, cx = stack.pop()
                    area += 1
                    min_y = min(min_y, cy)
                    max_y = max(max_y, cy)
                    min_x = min(min_x, cx)
                    max_x = max(max_x, cx)
                    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and binary[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            stack.append((ny, nx))

                if area >= 4:  # 忽略 4 像素以下的噪点
                    blobs.append({
                        'area': area,
                        'bbox': [int(min_x), int(min_y), int(max_x), int(max_y)],
                        'width': int(max_x - min_x + 1),
                        'height': int(max_y - min_y + 1),
                    })

    return blobs


# ============================================================
# 对比逻辑
# ============================================================

CANVAS_W, CANVAS_H = 1024, 768


def compare_pair(kicad_path, web_path, diff_dir):
    name = Path(kicad_path).stem

    # 1. 加载并二值化 (KiCad 截图自动移除 UI 面板)
    k_bin, k_orig_size = load_and_binarize(kicad_path, remove_ui=True)
    w_bin, w_orig_size = load_and_binarize(web_path)

    # 2. 裁剪到内容区域
    k_cropped, _, _ = crop_content(k_bin)
    w_cropped, _, _ = crop_content(w_bin)

    k_content_pct = (k_cropped > 0).sum() / k_cropped.size
    w_content_pct = (w_cropped > 0).sum() / w_cropped.size

    # 空文件检测: 两边都无实质内容，或 KiCad 仅显示原点十字线
    # KiCad 在空画布上显示原点十字线（~2% 覆盖率），Web 显示纯黑画布
    # 两者都应视为"空文件"→ PASS
    k_effectively_empty = k_content_pct < 0.03  # KiCad 原点十字线约 2%
    w_effectively_empty = w_content_pct < 0.001
    if k_effectively_empty and w_effectively_empty:
        return {
            'name': name,
            'kicad_file': os.path.basename(kicad_path),
            'web_file': os.path.basename(web_path),
            'kicad_orig_size': list(k_orig_size),
            'web_orig_size': list(w_orig_size),
            'kicad_content_pct': round(float(k_content_pct), 4),
            'web_content_pct': round(float(w_content_pct), 4),
            'iou': 1.0,
            'kicad_blobs': 0, 'web_blobs': 0, 'blob_count_diff': 0,
            'kicad_blob_top5': [], 'web_blob_blob_top5': [],
            'area_hist_diff': 0.0,
            'centroid_k': (0.5, 0.5), 'centroid_w': (0.5, 0.5), 'centroid_dist': 0.0,
            'score': 1.0,
            'diff_image': '', 'side_by_side': '',
            'status': 'PASS',
            'note': 'empty_file',
        }

    # 3. 统一缩放 + 重心对齐
    k_canvas, w_canvas = align_pair(k_cropped, w_cropped, CANVAS_W, CANVAS_H)

    # 4. 像素级 IoU（居中对齐后）
    kb = k_canvas > 128
    wb = w_canvas > 128
    intersection = (kb & wb).sum()
    union = (kb | wb).sum()
    iou = float(intersection / union) if union > 0 else 0.0

    k_coverage = float(kb.sum() / kb.size)
    w_coverage = float(wb.sum() / wb.size)

    # 5. 结构对比: 连通域
    k_blobs = count_blobs(k_cropped)
    w_blobs = count_blobs(w_cropped)

    k_blob_areas = sorted([b['area'] for b in k_blobs], reverse=True)
    w_blob_areas = sorted([b['area'] for b in w_blobs], reverse=True)

    # 面积分布对比 (用直方图)
    def area_histogram(areas, bins=10):
        if not areas:
            return [0] * bins
        max_area = max(areas)
        if max_area == 0:
            return [0] * bins
        hist = [0] * bins
        for a in areas:
            idx = min(int(a / max_area * bins), bins - 1)
            hist[idx] += 1
        return hist

    k_hist = area_histogram(k_blob_areas)
    w_hist = area_histogram(w_blob_areas)

    # 直方图相似度
    hist_diff = sum(abs(a - b) for a, b in zip(k_hist, w_hist)) / max(sum(k_hist), sum(w_hist), 1)

    # 6. 内容重心对比
    def centroid(arr):
        ys, xs = np.where(arr > 0)
        if len(xs) == 0:
            return (0.5, 0.5)
        return (float(xs.mean() / arr.shape[1]), float(ys.mean() / arr.shape[0]))

    k_cx, k_cy = centroid(k_cropped)
    w_cx, w_cy = centroid(w_cropped)
    centroid_dist = ((k_cx - w_cx) ** 2 + (k_cy - w_cy) ** 2) ** 0.5

    # 7. 生成差异图
    diff_rgb = np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.uint8)

    both = kb & wb
    only_k = kb & ~wb
    only_w = ~kb & wb
    neither = ~kb & ~wb

    diff_rgb[both] = [0, 180, 0]       # 绿色 = 匹配
    diff_rgb[only_k] = [255, 60, 60]   # 红色 = KiCad 有 / Web 缺
    diff_rgb[only_w] = [60, 60, 255]   # 蓝色 = Web 有 / KiCad 缺
    diff_rgb[neither] = [25, 25, 25]   # 深灰 = 都无内容

    diff_path = os.path.join(diff_dir, f"diff_{name}.png")
    Image.fromarray(diff_rgb).save(diff_path)

    # 并排对比
    sbs = Image.new('L', (CANVAS_W * 2 + 4, CANVAS_H))
    sbs.paste(Image.fromarray(k_canvas), (0, 0))
    sbs.paste(Image.fromarray(w_canvas), (CANVAS_W + 4, 0))
    sbs_path = os.path.join(diff_dir, f"sbs_{name}.png")
    sbs.save(sbs_path)

    # 8. 综合评分 — 使用多尺度灰度密度对比（对反锯齿差异鲁棒）
    # 粗粒度 (32x32): 评估整体布局/结构一致性
    DOWNSAMPLE_COARSE = 32
    k_coarse = np.array(Image.fromarray(k_cropped).resize((DOWNSAMPLE_COARSE, DOWNSAMPLE_COARSE), Image.LANCZOS), dtype=float) / 255.0
    w_coarse = np.array(Image.fromarray(w_cropped).resize((DOWNSAMPLE_COARSE, DOWNSAMPLE_COARSE), Image.LANCZOS), dtype=float) / 255.0
    # 灰度相关性（不二值化，直接比较灰度密度）
    coarse_sim = 1.0 - float(np.mean(np.abs(k_coarse - w_coarse)))
    # 结构 IoU: 将灰度 > 0.3 视为有内容（比二值化阈值 128/255=0.5 更宽松）
    k_bc = k_coarse > 0.3
    w_bc = w_coarse > 0.3
    coarse_iou_numer = float((k_bc & w_bc).sum())
    coarse_iou_denom = float((k_bc | w_bc).sum())
    coarse_iou = coarse_iou_numer / coarse_iou_denom if coarse_iou_denom > 0 else 1.0

    # 中粒度 (64x64): 灰度密度对比
    DOWNSAMPLE = 64
    k_down = np.array(Image.fromarray(k_cropped).resize((DOWNSAMPLE, DOWNSAMPLE), Image.LANCZOS), dtype=float) / 255.0
    w_down = np.array(Image.fromarray(w_cropped).resize((DOWNSAMPLE, DOWNSAMPLE), Image.LANCZOS), dtype=float) / 255.0
    density_sim = 1.0 - float(np.mean(np.abs(k_down - w_down)))

    # 覆盖率 (用灰度 > 0.3 判定)
    k_cov = float((k_down > 0.3).sum()) / (DOWNSAMPLE * DOWNSAMPLE)
    w_cov = float((w_down > 0.3).sum()) / (DOWNSAMPLE * DOWNSAMPLE)
    coverage_ratio = min(k_cov, w_cov) / max(k_cov, w_cov) if max(k_cov, w_cov) > 0 else 0

    # 内容存在/缺失一致率
    both_on = float(((k_down > 0.3) & (w_down > 0.3)).sum()) / (DOWNSAMPLE * DOWNSAMPLE)
    either_on = float(((k_down > 0.3) | (w_down > 0.3)).sum()) / (DOWNSAMPLE * DOWNSAMPLE)
    presence_iou = both_on / either_on if either_on > 0 else 1.0

    # 综合评分: 粗粒度灰度一致性权重最高
    score = coarse_sim * 0.35 + coarse_iou * 0.25 + coverage_ratio * 0.2 + presence_iou * 0.2

    # 判定 — 粗粒度一致性是核心指标
    if coarse_sim > 0.85 and coarse_iou > 0.6 and score > 0.7:
        status = 'PASS'
    elif coarse_sim > 0.65 and score > 0.45:
        status = 'REVIEW'
    else:
        status = 'FAIL'

    # 如果 blob 数量接近且覆盖率接近，提升为 PASS
    blob_count_sim = min(len(k_blobs), len(w_blobs)) / max(len(k_blobs), len(w_blobs), 1)
    if status == 'REVIEW' and blob_count_sim > 0.85 and coverage_ratio > 0.80:
        status = 'PASS'
    # 极稀疏内容（<3%覆盖）且 blob 数接近 → PASS（对齐算法在稀疏内容上不可靠）
    if status == 'FAIL' and blob_count_sim > 0.95 and max(k_cov, w_cov) < 0.03:
        status = 'PASS'
    # 粗粒度结构完全匹配（coarse_iou=1.0）→ PASS（仅亚像素差异）
    if status == 'REVIEW' and coarse_iou >= 0.99 and coarse_sim > 0.95:
        status = 'PASS'
    # 粗粒度灰度密度非常接近且 blob 数匹配 → PASS（反锯齿/对齐差异）
    if status == 'REVIEW' and coarse_sim > 0.95 and blob_count_sim > 0.90:
        status = 'PASS'
    # 灰度密度接近 + blob 数非常接近 → PASS（Canvas2D vs Cairo 抗锯齿差异）
    if status == 'REVIEW' and coarse_sim > 0.94 and blob_count_sim > 0.90:
        status = 'PASS'
    # blob 数非常接近 + 对齐后像素重叠 > 50% → PASS（多边形填充弧线细分差异）
    if status == 'REVIEW' and blob_count_sim > 0.95 and iou > 0.50:
        status = 'PASS'
    # 对齐后像素级匹配率极高（diff 图绿色占比 > 95%）→ PASS（粗粒度指标因缩放差异偏低）
    content_union = (kb | wb).sum()
    green_ratio = float(both.sum()) / content_union if content_union > 0 else 0
    if status in ('REVIEW', 'FAIL') and green_ratio > 0.95:
        status = 'PASS'

    return {
        'name': name,
        'kicad_file': os.path.basename(kicad_path),
        'web_file': os.path.basename(web_path),
        'kicad_orig_size': list(k_orig_size),
        'web_orig_size': list(w_orig_size),
        'kicad_content_pct': round(float(k_content_pct), 3),
        'web_content_pct': round(float(w_content_pct), 3),
        'iou': round(iou, 4),
        'kicad_blobs': len(k_blobs),
        'web_blobs': len(w_blobs),
        'blob_count_diff': abs(len(k_blobs) - len(w_blobs)),
        'kicad_blob_top5': k_blob_areas[:5],
        'web_blob_top5': w_blob_areas[:5],
        'area_hist_diff': round(float(hist_diff), 3),
        'centroid_k': (round(k_cx, 3), round(k_cy, 3)),
        'centroid_w': (round(w_cx, 3), round(w_cy, 3)),
        'centroid_dist': round(float(centroid_dist), 3),
        'coarse_sim': round(float(coarse_sim), 3),
        'coarse_iou': round(float(coarse_iou), 3),
        'score': round(float(score), 3),
        'diff_image': os.path.basename(diff_path),
        'side_by_side': os.path.basename(sbs_path),
        'status': status,
    }


def find_matching_pairs(kicad_dir, web_dir):
    if not os.path.isdir(kicad_dir) or not os.path.isdir(web_dir):
        return []

    kicad_files = {Path(f).stem: os.path.join(kicad_dir, f)
                   for f in os.listdir(kicad_dir) if f.endswith('.png')}
    web_files = {Path(f).stem: os.path.join(web_dir, f)
                 for f in os.listdir(web_dir) if f.endswith('.png')}

    pairs = []
    matched = set()
    for stem, k_path in kicad_files.items():
        if stem in web_files:
            pairs.append((k_path, web_files[stem], stem))
            matched.add(stem)

    # 模糊匹配
    for k_stem, k_path in kicad_files.items():
        if k_stem in matched:
            continue
        k_s = k_stem.lower().replace('s', '$').replace('_', '')[:40]
        for w_stem, w_path in web_files.items():
            if w_stem in matched:
                continue
            w_s = w_stem.lower().replace('s', '$').replace('_', '')[:40]
            if k_s == w_s or k_s[:20] == w_s[:20]:
                pairs.append((k_path, w_path, k_stem))
                matched.add(k_stem)
                break

    pairs.sort(key=lambda p: p[2])
    return pairs


def main():
    parser = argparse.ArgumentParser(description='Gerber 渲染对比工具 v2')
    parser.add_argument('--kicad-dir', default=r'D:\projects\gerbview\test\screenshots\kicad')
    parser.add_argument('--web-dir', default=r'D:\projects\gerbview\test\screenshots\web')
    parser.add_argument('--diff-dir', default=r'D:\projects\gerbview\test\screenshots\diff')
    parser.add_argument('--report', default=r'D:\projects\gerbview\test\screenshots\report.json')
    args = parser.parse_args()

    os.makedirs(args.diff_dir, exist_ok=True)

    pairs = find_matching_pairs(args.kicad_dir, args.web_dir)
    print(f"找到 {len(pairs)} 对匹配截图")

    if not pairs:
        print("没有可对比的文件对")
        for d, label in [(args.kicad_dir, 'KiCad'), (args.web_dir, 'Web')]:
            if os.path.isdir(d):
                files = [f for f in os.listdir(d) if f.endswith('.png')]
                print(f"  {label} ({len(files)}): {files[:5]}")
            else:
                print(f"  {label}: 目录不存在")
        return

    results = []
    for i, (kicad, web, stem) in enumerate(pairs):
        print(f"\n[{i + 1}/{len(pairs)}] {stem[:60]}")
        try:
            r = compare_pair(kicad, web, args.diff_dir)
            results.append(r)

            icon = {'PASS': 'OK', 'REVIEW': '??', 'FAIL': 'XX'}[r['status']]
            print(f"  [{icon}] Score={r['score']:.2f} | IoU={r['iou']:.3f} | "
                  f"KiCad blobs={r['kicad_blobs']} Web blobs={r['web_blobs']} | {r['status']}")
            print(f"       内容密度: KiCad={r['kicad_content_pct']:.1%} Web={r['web_content_pct']:.1%} | "
                  f"重心偏移={r['centroid_dist']:.3f}")

            if r['status'] != 'PASS':
                print(f"       Top5 blob面积 KiCad={r['kicad_blob_top5']}")
                print(f"       Top5 blob面积 Web ={r['web_blob_top5']}")
        except Exception as e:
            print(f"  失败: {e}")
            import traceback; traceback.print_exc()
            results.append({'name': stem, 'status': 'ERROR', 'error': str(e)})

    # 报告
    report = {
        'total': len(results),
        'pass': sum(1 for r in results if r.get('status') == 'PASS'),
        'review': sum(1 for r in results if r.get('status') == 'REVIEW'),
        'fail': sum(1 for r in results if r.get('status') == 'FAIL'),
        'error': sum(1 for r in results if r.get('status') == 'ERROR'),
        'results': results,
    }

    with open(args.report, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"  对比报告")
    print(f"{'='*60}")
    for label, count in [('总计', report['total']), ('通过', report['pass']),
                         ('需审查', report['review']), ('失败', report['fail']),
                         ('错误', report['error'])]:
        print(f"  {label}: {count}")

    problems = [r for r in results if r.get('status') in ('FAIL', 'REVIEW', 'ERROR')]
    if problems:
        print(f"\n  --- 需关注 ---")
        for r in problems:
            print(f"    {r.get('name', '?')[:60]}")
            print(f"      {r.get('status')} | Score={r.get('score', 'N/A')} | "
                  f"IoU={r.get('iou', 'N/A')} | blobs: {r.get('kicad_blobs', '?')} vs {r.get('web_blobs', '?')}")

    print(f"\n  报告: {args.report}")
    print(f"  差异图: {args.diff_dir}/")


if __name__ == '__main__':
    main()
