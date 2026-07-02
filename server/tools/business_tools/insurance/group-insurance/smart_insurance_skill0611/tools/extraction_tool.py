"""
Smart Insurance Skill 0611 - 数据提取工具

封装合同分割、报价单提取、数据合并等提取逻辑
"""

import logging
import re
import copy
from typing import Dict, Any, List, Optional
from pathlib import Path

from smart_insurance_skill0611.core.exceptions import ExtractionError
from smart_insurance_skill0611.core.constants import MODULE_EXTRACT_RULES

logger = logging.getLogger(__name__)


class ExtractionTool:
    """
    数据提取工具 - 处理合同分割、报价单提取等

    功能：
    - 合同内容按方案分割
    - 提取特定模块（basic_info, case_relation, group_agreement等）
    - 报价单方案内容提取
    - 数据合并和字段映射

    使用示例:
        extraction_tool = ExtractionTool()

        # 按方案分割合同
        result = extraction_tool.extract_contract_content(
            scheme_list,
            file_path
        )

        # 提取模块内容
        module_content = extraction_tool.extract_module_content(
            file_path,
            'basic_info'
        )
    """

    def __init__(self):
        """初始化提取工具"""
        self.module_rules = MODULE_EXTRACT_RULES

    def extract_contract_content(
        self,
        scheme_list: List[Dict],
        file_path: str
    ) -> Dict[str, Any]:
        """
        按行提取文本中的方案内容和公共信息

        核心功能：
        1. 按方案名称分割合同文本到各方案
        2. 提取特定模块（basic_info, case_relation, group_agreement, personal_agreement）
        3. 提取公共信息（未被方案和模块覆盖的内容）

        Args:
            scheme_list: 包含方案名称和序号的列表
                [{"名称": "方案A", "序号": "01"}, ...]
            file_path: 文本文件路径

        Returns:
            提取结果字典:
            {
                "common": "...",           # 公共信息
                "basic_info": "...",       # 基础保单信息
                "case_relation": "...",    # 层级与方案关系
                "group_agreement": "...",  # 团体特约
                "personal_agreement": "...",# 个人特约
                "方案A": "...",            # 各方案内容
                "方案B": "...",
            }
        """
        # 1.读取文本内容
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_txt = f.read()  # 原始完整文本（用于提取<page>块）
            f.seek(0)  # 重置文件指针
            lines = f.readlines()  # 按行分割文本（用于行号定位）

        total_lines = len(lines)

        # 2. 预处理：提取所有<page>块及对应的行号范围
        page_pattern = r'(<page[^>]*>[\s\S]*?</page[^>]*>)'
        page_matches = re.findall(page_pattern, raw_txt, re.IGNORECASE)

        # 构建"每行文本在原始文本中的位置映射"
        line_position_map = []
        current_pos = 0
        for line_idx, line in enumerate(lines):
            line_len = len(line)
            line_start = current_pos
            line_end = current_pos + line_len - 1
            line_position_map.append((line_idx, line_start, line_end))
            current_pos += line_len

        # 解析每个<page>块的内容和对应的行号范围
        page_blocks = []
        for page_content in page_matches:
            page_start_pos = raw_txt.find(page_content)
            page_end_pos = page_start_pos + len(page_content) - 1

            # 映射到对应的行号范围
            page_start_line = -1
            page_end_line = -1
            for line_idx, line_start, line_end in line_position_map:
                if page_start_pos >= line_start and page_start_pos <= line_end:
                    page_start_line = line_idx
                if page_end_pos >= line_start and page_end_pos <= line_end:
                    page_end_line = line_idx
                if page_start_line != -1 and page_end_line != -1:
                    break

            page_blocks.append({
                "content": page_content,
                "start_line": page_start_line,
                "end_line": page_end_line
            })

        # 3. 为每个方案找到起始行号
        scheme_positions = []
        for scheme in scheme_list:
            scheme_name = scheme["名称"]
            scheme_no = str(scheme["序号"])
            start_line = -1

            # 遍历每行文本查找匹配
            for i, line in enumerate(lines):
                if i < total_lines - 1:
                    combined = line + lines[i + 1]
                    if (re.search(f'方案序号.*{re.escape(scheme_no)}', combined) and
                            re.search(f'方案名称.*{re.escape(scheme_name)}', combined)):
                        start_line = i
                        break

            if start_line != -1:
                scheme_positions.append({
                    "name": scheme_name,
                    "start": start_line
                })

        # 按出现顺序排序方案
        scheme_positions.sort(key=lambda x: x["start"])
        scheme_count = len(scheme_positions)

        # 4. 确定每个方案的结束行号并提取内容
        scheme_contents = {}
        for i in range(scheme_count):
            current = scheme_positions[i]
            current_name = current["name"]
            current_start = current["start"]

            # 确定结束行：下一个方案的起始行或最后一行
            if i < scheme_count - 1:
                current_end = scheme_positions[i + 1]["start"] - 1
            else:
                current_end = total_lines - 1

            # 提取方案内容
            content_lines = lines[current_start:current_end + 1]
            scheme_contents[current_name] = ''.join(content_lines).rstrip('\n')
            # 去掉方案内部的\n和空格
            scheme_contents[current_name] = scheme_contents[current_name].replace('\n', '').replace(' ', '')

        # 5. 提取团单特定模块信息
        module_contents = {}
        module_covered_lines = set()

        for module_key, rule in self.module_rules.items():
            title_pattern = rule["title_pattern"]
            matched_page = None

            # 遍历所有<page>块，找包含当前模块标题的块
            for page in page_blocks:
                if re.search(title_pattern, page["content"], re.IGNORECASE):
                    matched_page = page
                    break

            if not matched_page:
                module_contents[module_key] = ""
                continue

            # 提取<page>块内的全部内容（清理后）
            module_raw = matched_page["content"]
            module_cleaned = self._clean_module_content(module_raw)
            module_contents[module_key] = module_cleaned

            # 记录当前<page>块覆盖的行号
            page_start = matched_page["start_line"]
            page_end = matched_page["end_line"]
            if page_start != -1 and page_end != -1:
                module_covered_lines.update(range(page_start, page_end + 1))

        # 6. 收集所有方案覆盖的行号
        scheme_covered_lines = set()
        for i in range(scheme_count):
            start = scheme_positions[i]["start"]
            if i < scheme_count - 1:
                end = scheme_positions[i + 1]["start"] - 1
            else:
                end = total_lines - 1
            scheme_covered_lines.update(range(start, end + 1))

        # 7. 提取公共信息（排除方案和模块对应的行）
        all_covered_lines = scheme_covered_lines.union(module_covered_lines)
        common_lines = [lines[i] for i in range(total_lines) if i not in all_covered_lines]
        common_raw = ''.join(common_lines).rstrip('\n')
        common_cleaned = re.sub(r'\n+', '\n', common_raw).strip()

        # 8. 构建最终结果字典
        result = {
            "common": common_cleaned,
            **module_contents,
            **scheme_contents
        }

        logger.info(f"合同分割完成，提取{len(scheme_contents)}个方案")
        return result

    def extract_module_content(
        self,
        file_path: str,
        module_key: str
    ) -> str:
        """
        提取单个模块内容

        Args:
            file_path: 文件路径
            module_key: 模块键名（basic_info, case_relation等）

        Returns:
            模块内容字符串
        """
        rule = self.module_rules.get(module_key)
        if not rule:
            logger.warning(f"未知模块键: {module_key}")
            return ""

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 查找包含模块标题的<page>块
        page_pattern = r'(<page[^>]*>[\s\S]*?</page[^>]*>)'
        page_matches = re.findall(page_pattern, content, re.IGNORECASE)

        for page_content in page_matches:
            if re.search(rule["title_pattern"], page_content, re.IGNORECASE):
                return self._clean_module_content(page_content)

        logger.warning(f"未找到模块: {module_key}")
        return ""

    def extract_quotation_content(
        self,
        file_path: str
    ) -> Dict[str, Any]:
        """
        提取报价单内容

        Args:
            file_path: 报价单文本文件路径

        Returns:
            报价单内容:
            {
                'scheme_info': {...},
                'agreement': '特约内容',
                'hierarchy': {...}
            }
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        result = {
            'scheme_info': {},
            'agreement': '',
            'hierarchy': {}
        }

        # 提取方案信息
        scheme_pattern = r'方案名称[:：]?\s*(.*?)(?:\n|$)'
        scheme_matches = re.findall(scheme_pattern, content)
        if scheme_matches:
            result['scheme_info']['方案名称'] = scheme_matches

        # 提取特约内容
        agreement_pattern = r'特约[:：]?\s*(.*?)(?:\n|$)'
        agreement_matches = re.findall(agreement_pattern, content)
        if agreement_matches:
            result['agreement'] = '\n'.join(agreement_matches)

        # 提取层级信息
        hierarchy_pattern = r'层级[:：]?\s*(.*?)(?:\n|$)'
        hierarchy_matches = re.findall(hierarchy_pattern, content)
        if hierarchy_matches:
            result['hierarchy']['层级'] = hierarchy_matches

        logger.info(f"报价单提取完成")
        return result

    def extract_quotation_scheme_info(
        self,
        quotation_text: str
    ) -> Dict[str, Any]:
        """
        从报价单文本中提取方案信息

        Args:
            quotation_text: 报价单文本

        Returns:
            方案信息字典
        """
        result = {}

        # 提取方案内容
        lines = quotation_text.split('\n')
        current_scheme = None
        scheme_content = []

        for line in lines:
            # 检测方案标题
            if '方案名称' in line or '方案序号' in line:
                if current_scheme and scheme_content:
                    result[current_scheme] = '\n'.join(scheme_content)
                    scheme_content = []
                current_scheme = line.strip()
            else:
                if current_scheme:
                    scheme_content.append(line)

        if current_scheme and scheme_content:
            result[current_scheme] = '\n'.join(scheme_content)

        return result

    def merge_contract_quotation(
        self,
        contract_data: Dict[str, Any],
        quotation_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        合同和报价单数据合并

        Args:
            contract_data: 合同数据
            quotation_data: 报价单数据

        Returns:
            合并后的数据
        """
        merged = copy.deepcopy(contract_data)

        # 合并方案信息（报价单优先）
        for scheme_name, scheme_content in quotation_data.get('scheme_info', {}).items():
            if scheme_name in merged:
                # 报价单信息补充到合同方案中
                merged[scheme_name] = f"{merged[scheme_name]}\n报价单补充:\n{scheme_content}"
            else:
                merged[scheme_name] = scheme_content

        # 合并特约内容（报价单优先）
        quotation_agreement = quotation_data.get('agreement', '')
        if quotation_agreement:
            merged['quotation_agreement'] = quotation_agreement

        # 合并层级信息
        quotation_hierarchy = quotation_data.get('hierarchy', {})
        if quotation_hierarchy:
            merged['quotation_hierarchy'] = quotation_hierarchy

        logger.info(f"数据合并完成")
        return merged

    def _clean_module_content(self, content: str) -> str:
        """
        清理模块内容

        Args:
            content: 原始内容

        Returns:
            清理后的内容
        """
        # 移除<page>标签
        cleaned = re.sub(r'</?page[^>]*>', '', content)
        # 合并空行
        cleaned = re.sub(r'\n+', '\n', cleaned)
        return cleaned.strip()

    def split_contract_by_schemes(
        self,
        contract_text: str,
        scheme_list: List[Dict]
    ) -> Dict[str, str]:
        """
        按方案分割合同文本（简化版，直接处理文本）

        Args:
            contract_text: 合同文本
            scheme_list: 方案列表

        Returns:
            分割结果
        """
        result = {}

        # 使用方案序号和名称定位
        for scheme in scheme_list:
            scheme_name = scheme["名称"]
            scheme_no = scheme["序号"]

            # 查找方案起始位置
            pattern = f'方案序号.*{scheme_no}.*方案名称.*{scheme_name}'
            match = re.search(pattern, contract_text, re.IGNORECASE | re.DOTALL)

            if match:
                # 简化处理：返回匹配位置后的内容
                start_pos = match.end()
                result[scheme_name] = contract_text[start_pos:start_pos + 1000]
            else:
                result[scheme_name] = ""

        return result

    def extract_json_from_text(
        self,
        text: str
    ) -> Dict[str, Any]:
        """
        从文本中提取JSON结构

        Args:
            text: 包含JSON的文本

        Returns:
            JSON字典
        """
        import json

        # 尝试直接解析
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 提取JSON部分
        json_pattern = r'\{[\s\S]*\}'
        matches = re.findall(json_pattern, text)

        if matches:
            # 尝试解析最长的JSON
            for match in matches:
                try:
                    return json.loads(match)
                except json.JSONDecodeError:
                    continue

        logger.warning(f"JSON提取失败，返回空字典")
        return {}