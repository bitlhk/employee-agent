"""
Smart Insurance Skill 0611 - 文档处理工具

封装PDF转图片、文本合并等文档处理逻辑
"""

import logging
import os
import re
from typing import Dict, Any, List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class DocumentTool:
    """
    文档处理工具 - 处理PDF、文本合并等

    功能：
    - PDF转图片（通过MCP服务）
    - 文本合并
    - 文档预处理

    使用示例:
        document_tool = DocumentTool()

        # 文本合并
        merged_text = document_tool.merge_texts(
            '/path/to/ocr_dir',
            '/path/to/merged.txt'
        )
    """

    def __init__(self):
        """初始化文档工具"""
        pass

    def merge_texts(
        self,
        input_dir: str,
        output_file: str,
        enable_page_tag: bool = True
    ) -> str:
        """
        合并多个文本文件

        Args:
            input_dir: 输入目录（包含多个txt文件）
            output_file: 输出文件路径
            enable_page_tag: 是否添加<page>标签

        Returns:
            合并后的文件路径
        """
        input_path = Path(input_dir)
        output_path = Path(output_file)

        # 获取所有txt文件
        txt_files = sorted(input_path.glob('*.txt'))

        if not txt_files:
            logger.warning(f"目录中没有txt文件: {input_dir}")
            return ""

        # 合并文本
        merged_content = []
        for idx, txt_file in enumerate(txt_files, start=1):
            with open(txt_file, 'r', encoding='utf-8') as f:
                content = f.read()

                if enable_page_tag:
                    # 添加page标签
                    page_number = self._extract_page_number(txt_file.name)
                    tagged_content = f"<page{page_number:02d}>{content}</page{page_number:02d}>"
                    merged_content.append(tagged_content)
                else:
                    merged_content.append(content)

        # 保存合并后的文本
        output_path.parent.mkdir(parents=True, exist_ok=True)
        final_content = '\n'.join(merged_content)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(final_content)

        logger.info(f"合并完成: {len(txt_files)}个文件 -> {output_file}")
        return str(output_path)

    def _extract_page_number(self, filename: str) -> int:
        """
        从文件名中提取页码

        Args:
            filename: 文件名

        Returns:
            页码数字
        """
        # 尝试从文件名中提取数字
        match = re.search(r'(\d+)', filename)
        if match:
            return int(match.group(1))
        return 1

    def clean_text(
        self,
        text: str,
        remove_empty_lines: bool = True,
        remove_extra_spaces: bool = True
    ) -> str:
        """
        清理文本内容

        Args:
            text: 原始文本
            remove_empty_lines: 是否移除空行
            remove_extra_spaces: 是否移除多余空格

        Returns:
            清理后的文本
        """
        cleaned = text

        if remove_empty_lines:
            cleaned = re.sub(r'\n\s*\n', '\n', cleaned)

        if remove_extra_spaces:
            cleaned = re.sub(r' +', ' ', cleaned)
            cleaned = re.sub(r'\n +', '\n', cleaned)

        return cleaned.strip()

    def split_text_by_pages(
        self,
        text: str
    ) -> Dict[int, str]:
        """
        按<page>标签分割文本

        Args:
            text: 包含<page>标签的文本

        Returns:
            页码到内容的映射
        """
        pages = {}

        # 提取所有<page>块
        page_pattern = r'<page(\d+)>[\s\S]*?</page\d+>'
        matches = re.findall(page_pattern, text, re.IGNORECASE)

        for match in matches:
            page_pattern_full = f'<page{match}>[\s\S]*?</page{match}>'
            page_content_match = re.search(page_pattern_full, text, re.IGNORECASE)
            if page_content_match:
                page_number = int(match)
                content = page_content_match.group(0)
                # 移除标签
                content = re.sub(r'</?page\d+>', '', content)
                pages[page_number] = content.strip()

        return pages

    def extract_page_content(
        self,
        text: str,
        page_number: int
    ) -> str:
        """
        提取指定页的内容

        Args:
            text: 包含<page>标签的文本
            page_number: 页码

        Returns:
            页面内容
        """
        page_pattern = f'<page{page_number:02d}>[\s\S]*?</page{page_number:02d}>'
        match = re.search(page_pattern, text, re.IGNORECASE)

        if match:
            content = match.group(0)
            # 移除标签
            content = re.sub(r'</?page\d+>', '', content)
            return content.strip()

        logger.warning(f"未找到页码{page_number}的内容")
        return ""

    def create_output_directory(
        self,
        base_dir: str,
        task_id: str,
        subdirs: List[str] = None
    ) -> Dict[str, str]:
        """
        创建输出目录结构

        Args:
            base_dir: 基础目录
            task_id: 任务ID
            subdirs: 子目录列表

        Returns:
            目录路径映射
        """
        default_subdirs = ['contract', 'ocr', 'quotation', 'data', 'log', 'split']
        subdirs = subdirs or default_subdirs

        task_dir = Path(base_dir) / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        dir_paths = {}
        for subdir in subdirs:
            subdir_path = task_dir / subdir
            subdir_path.mkdir(exist_ok=True)
            dir_paths[subdir] = str(subdir_path)

        logger.info(f"输出目录创建完成: {task_dir}")
        return dir_paths

    def read_text_file(
        self,
        file_path: str
    ) -> str:
        """
        读取文本文件

        Args:
            file_path: 文件路径

        Returns:
            文件内容
        """
        path = Path(file_path)
        if not path.exists():
            logger.warning(f"文件不存在: {file_path}")
            return ""

        with open(path, 'r', encoding='utf-8') as f:
            return f.read()

    def write_text_file(
        self,
        file_path: str,
        content: str
    ) -> str:
        """
        写入文本文件

        Args:
            file_path: 文件路径
            content: 文件内容

        Returns:
            文件路径
        """
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

        logger.info(f"文件写入完成: {file_path}")
        return str(path)

    def read_json_file(
        self,
        file_path: str
    ) -> Dict[str, Any]:
        """
        读取JSON文件

        Args:
            file_path: 文件路径

        Returns:
            JSON数据
        """
        import json

        path = Path(file_path)
        if not path.exists():
            logger.warning(f"文件不存在: {file_path}")
            return {}

        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def write_json_file(
        self,
        file_path: str,
        data: Dict[str, Any]
    ) -> str:
        """
        写入JSON文件

        Args:
            file_path: 文件路径
            data: JSON数据

        Returns:
            文件路径
        """
        import json

        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

        logger.info(f"JSON文件写入完成: {file_path}")
        return str(path)