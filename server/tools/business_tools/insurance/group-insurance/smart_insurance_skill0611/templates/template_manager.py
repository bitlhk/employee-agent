"""
Smart Insurance Skill 0611 - 模板管理器

管理所有Prompt模板和Few-shot样例
"""

import os
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)


class TemplateManager:
    """
    模板管理器 - 加载和管理Prompt模板

    功能：
    - 加载保险领域Prompt模板
    - 管理Few-shot样例图片
    - 支持模板替换和定制

    使用示例:
        template_manager = TemplateManager('./templates')

        # 加载所有Prompt模板
        prompts = template_manager.load_prompts('insurance')

        # 获取特定Prompt
        prompt = template_manager.get_prompt('directory_relation')
    """

    def __init__(self, base_dir: str = './templates'):
        """
        初始化模板管理器

        Args:
            base_dir: 模板基础目录
        """
        self.base_dir = Path(base_dir)
        self._prompts: Dict[str, str] = {}
        self._fewshot_dir: Optional[str] = None

        # 模板名称映射
        self.template_mapping = {
            'directory_relation': 'PDF层级和方案关系获取.md',
            'quotation_relation': '报价单层级信息提取.md',
            'basic_info': 'PDF基础信息转json.md',
            'scheme_special': 'PDF层级字段方案.md',
            'liability': 'PDF层级字段保险责任.md',
            'hospital': 'PDF层级字段医院.md',
            'deductible': 'PDF层级字段免赔限额.md',
            'payment_info': 'PDF层级字段赔付信息.md',
            'classify_page': 'prompt1_多模态_页面分类.md',
            'extract_text': 'prompt2_多模态_文本抽取.md',
            'coordinate': 'prompt3_多模态_文本坐标定位_LL_P15.md',
            'extract_table': 'prompt4_多模态_表格抽取.md',
            'quotation': 'prompt5_多模态_报价单.md'
        }

    def load_prompts(self, domain: str = 'insurance') -> Dict[str, str]:
        """
        加载指定领域的所有Prompt模板

        Args:
            domain: 领域名称（默认insurance）

        Returns:
            Prompt模板字典
        """
        domain_dir = self.base_dir / domain

        if not domain_dir.exists():
            logger.warning(f"领域目录不存在: {domain_dir}")
            return {}

        # 加载所有.md文件
        md_files = list(domain_dir.glob('*.md'))

        for md_file in md_files:
            template_name = md_file.stem  # 文件名（不含扩展名）
            self._load_single_prompt(md_file, template_name)

        logger.info(f"加载完成，共{len(self._prompts)}个Prompt模板")
        return self._prompts.copy()

    def _load_single_prompt(self, file_path: Path, template_name: str) -> None:
        """
        加载单个Prompt模板

        Args:
            file_path: 文件路径
            template_name: 模板名称
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # 映射到标准名称
            standard_name = self.template_mapping.get(template_name, template_name)
            self._prompts[standard_name] = content

            logger.debug(f"加载Prompt模板: {template_name} -> {standard_name}")

        except Exception as e:
            logger.warning(f"加载Prompt模板失败: {file_path}, 错误: {e}")

    def get_prompt(self, template_name: str) -> str:
        """
        获取Prompt模板

        Args:
            template_name: 模板名称

        Returns:
            模板内容
        """
        # 尝试标准名称
        if template_name in self._prompts:
            return self._prompts[template_name]

        # 尝试映射名称
        mapped_name = self.template_mapping.get(template_name)
        if mapped_name and mapped_name in self._prompts:
            return self._prompts[mapped_name]

        # 尝试文件名
        file_name = self.template_mapping.get(template_name, f"{template_name}.md")
        if file_name in self._prompts:
            return self._prompts[file_name]

        logger.warning(f"未找到Prompt模板: {template_name}")
        return ""

    def get_fewshot_dir(self) -> str:
        """
        获取Few-shot样例目录

        Returns:
            Few-shot目录路径
        """
        if self._fewshot_dir:
            return self._fewshot_dir

        # 默认路径
        default_dir = self.base_dir / 'insurance' / 'few-shot'

        if default_dir.exists():
            self._fewshot_dir = str(default_dir)
            logger.info(f"Few-shot目录: {self._fewshot_dir}")
            return self._fewshot_dir

        logger.warning(f"Few-shot目录不存在: {default_dir}")
        return ""

    def list_available_templates(self) -> List[str]:
        """
        列出所有可用的模板名称

        Returns:
            模板名称列表
        """
        return list(self._prompts.keys())

    def add_custom_prompt(self, template_name: str, content: str) -> None:
        """
        添加自定义Prompt模板

        Args:
            template_name: 模板名称
            content: 模板内容
        """
        self._prompts[template_name] = content
        logger.info(f"添加自定义Prompt模板: {template_name}")

    def save_prompt(self, template_name: str, file_path: str) -> None:
        """
        保存Prompt模板到文件

        Args:
            template_name: 模板名称
            file_path: 文件路径
        """
        content = self._prompts.get(template_name)
        if not content:
            logger.warning(f"模板不存在: {template_name}")
            return

        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

        logger.info(f"Prompt模板保存到: {file_path}")

    def replace_placeholder(
        self,
        template_name: str,
        replacements: Dict[str, str]
    ) -> str:
        """
        替换Prompt模板中的占位符

        Args:
            template_name: 模板名称
            replacements: 替换字典（占位符 -> 实际值）

        Returns:
            替换后的Prompt
        """
        prompt = self.get_prompt(template_name)

        for placeholder, value in replacements.items():
            prompt = prompt.replace(placeholder, value)

        return prompt