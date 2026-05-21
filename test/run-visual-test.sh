#!/bin/bash
# ============================================================
# Gerber 渲染对比测试 — 一键运行
#
# 流程:
#   1. KiCad GerbView 逐文件截图
#   2. Web 前端逐文件截图 (Playwright + Vite)
#   3. 像素级对比并生成报告
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_FILES="$PROJECT_DIR/docs/test-files"
SCREENSHOTS="$SCRIPT_DIR/screenshots"

KICAD_DIR="$SCREENSHOTS/kicad"
WEB_DIR="$SCREENSHOTS/web"
DIFF_DIR="$SCREENSHOTS/diff"

MAX_FILES="${1:-5}"  # 默认只处理前5个文件

echo "============================================================"
echo "  Gerber 渲染对比测试"
echo "  测试文件目录: $TEST_FILES"
echo "  最大文件数: $MAX_FILES"
echo "============================================================"

# Step 0: 安装 Python 依赖
echo ""
echo "[Step 0] 检查依赖..."
pip show scipy numpy Pillow pywinauto > /dev/null 2>&1 || {
    echo "安装 Python 依赖..."
    pip install scipy numpy Pillow pywinauto
}

# Step 1: KiCad 截图
echo ""
echo "[Step 1] KiCad GerbView 截图..."
mkdir -p "$KICAD_DIR"
python "$SCRIPT_DIR/screenshot-kicad.py" \
    --test-dir "$TEST_FILES" \
    --output-dir "$KICAD_DIR" \
    --max-files "$MAX_FILES"

# Step 2: Web 前端截图
echo ""
echo "[Step 2] Web 前端截图..."
mkdir -p "$WEB_DIR"
node "$SCRIPT_DIR/screenshot-web.mjs" \
    --test-dir "$TEST_FILES" \
    --output-dir "$WEB_DIR" \
    --max-files "$MAX_FILES"

# Step 3: 像素对比
echo ""
echo "[Step 3] 像素级对比..."
mkdir -p "$DIFF_DIR"
python "$SCRIPT_DIR/compare-screenshots.py" \
    --kicad-dir "$KICAD_DIR" \
    --web-dir "$WEB_DIR" \
    --diff-dir "$DIFF_DIR" \
    --report "$SCREENSHOTS/report.json"

echo ""
echo "============================================================"
echo "  测试完成！查看报告: $SCREENSHOTS/report.json"
echo "  差异图: $DIFF_DIR/"
echo "============================================================"
