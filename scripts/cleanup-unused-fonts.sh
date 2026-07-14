#!/bin/sh
# 清理未使用的字体文件
# 只保留 CSS 中引用的字体文件

CSS_FILE=$(find dist/client/assets -name "*.css" | head -1)

if [ -z "$CSS_FILE" ]; then
  echo "未找到 CSS 文件"
  exit 0
fi

# 提取 CSS 中引用的字体文件名（去除扩展名）
grep -oE 'noto-sans-sc-[0-9]+-[0-9]+-normal-[A-Za-z0-9]+' "$CSS_FILE" 2>/dev/null | \
  sort -u | \
  sed 's/$/\.woff*/' > /tmp/used_fonts_patterns.txt

# 查找所有字体文件
find dist/client/assets -name '*.woff*' -type f | while read font_file; do
  font_name=$(basename "$font_file" | sed 's/\.[^.]*$//')
  
  # 检查是否在 CSS 中引用
  if ! grep -q "^$font_name\.woff" /tmp/used_fonts_patterns.txt 2>/dev/null; then
    echo "删除未使用的字体: $font_name"
    rm -f "$font_file"
  fi
done

rm -f /tmp/used_fonts_patterns.txt

echo "字体文件清理完成"

