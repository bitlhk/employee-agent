"""
Smart Insurance Skill 0611 - 数据处理模块

提供数据合并、排序、验证等功能，确保提取结果的完整性和准确性
"""

import copy
import json
import re
from typing import List, Dict, Any, Optional


class DataProcessor:
    """
    数据处理器 - 合并、排序、验证提取结果

    使用示例:
        processor = DataProcessor()

        # 合并二次推理结果
        merged_data = processor.merge_secondary_results(primary_data, secondary_data)

        # 按层级关系排序
        ordered_data = processor.order_by_hierarchy(liability_data, directory_data)

        # 验证字段完整性
        validated_data = processor.validate_fields(data, field_definitions)
    """

    def __init__(self):
        """初始化数据处理器"""
        self.key_fields = ["保险种类", "保险责任"]

    def merge_secondary_results(
        self,
        primary_data: List[Dict[str, Any]],
        secondary_data: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        合并二次推理结果到主推理数据

        根据保险种类+保险责任匹配，将二次推理提取的字段合并到主推理结果中

        Args:
            primary_data: 主推理数据列表
            secondary_data: 二次推理数据列表

        Returns:
            合并后的数据列表
        """
        if not secondary_data:
            return primary_data

        # 遍历二次推理数据中的每个元素
        for secondary_item in secondary_data:
            # 提取基准字段的值作为匹配键
            key_values = tuple(secondary_item.get(field, '') for field in self.key_fields)

            # 查找主推理数据中匹配的元素
            for primary_item in primary_data:
                # 检查是否所有基准字段都匹配
                if tuple(primary_item.get(field, '') for field in self.key_fields) == key_values:
                    # 提取二次推理数据中的非基准字段并更新到主推理数据
                    for field, value in secondary_item.items():
                        if field not in self.key_fields:
                            primary_item[field] = value
                    break  # 找到匹配项后退出内部循环

        return primary_data

    def merge_scheme_special_agreement(
        self,
        liability_data: List[Dict[str, Any]],
        scheme_special_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        合并方案特约到保险责任数据

        Args:
            liability_data: 保险责任数据列表
            scheme_special_data: 方案特约数据字典

        Returns:
            合并方案特约后的数据列表
        """
        if not scheme_special_data:
            return liability_data

        # 遍历保险责任数据，添加方案特约字段
        for item in liability_data:
            scheme_name = item.get('方案名称', '')
            if scheme_name in scheme_special_data:
                item['方案特约'] = scheme_special_data[scheme_name]

        return liability_data

    def order_by_hierarchy(
        self,
        insurance_liability: List[Dict[str, Any]],
        directory_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        按层级关系排序保险责任数据

        根据层级与方案的对应关系，按层级名称顺序排序保险责任数据
        一个层级可以对应多个方案

        Args:
            insurance_liability: 保险责任数据列表
            directory_data: 层级与方案对应关系数据

        Returns:
            排序后的保险责任数据列表
        """
        ordered_list = []

        # 获取层级名称顺序
        level_order = directory_data.get('层级名称顺序', [])
        level_scheme_relation = directory_data.get('层级与方案关系', {})

        # 按层级名称顺序排序
        for level_name in level_order:
            # 获取层级对应的方案序号
            scheme_serial = self._get_scheme_serial(level_name, directory_data)

            # 遍历层级对应的方案
            for scheme_name in level_scheme_relation.get(level_name, []):
                # 查找该方案的所有保险责任数据
                for item in insurance_liability:
                    if item.get('方案名称') == scheme_name:
                        # 创建副本，添加层级名称和方案序号
                        ordered_item = copy.deepcopy(item)
                        ordered_item['层级名称'] = level_name
                        ordered_item['方案序号'] = scheme_serial
                        ordered_list.append(ordered_item)

        # 处理未出现在层级对应关系中的方案
        unused_schemes = directory_data.get('未出现的方案名称', [])
        for scheme in unused_schemes:
            for item in insurance_liability:
                if item.get('方案名称') == scheme.get('名称'):
                    ordered_item = copy.deepcopy(item)
                    ordered_item['层级名称'] = scheme.get('名称')
                    ordered_item['方案序号'] = str(scheme.get('序号', ''))
                    ordered_list.append(ordered_item)

        return ordered_list

    def _get_scheme_serial(
        self,
        level_name: str,
        directory_data: Dict[str, Any]
    ) -> str:
        """
        获取层级对应的方案序号（多个方案的序号拼接）

        Args:
            level_name: 层级名称
            directory_data: 层级与方案对应关系数据

        Returns:
            方案序号字符串（多个序号拼接）
        """
        scheme_serial = ''

        level_scheme_relation = directory_data.get('层级与方案关系', {})
        scheme_list = directory_data.get('方案名称', [])

        # 遍历层级对应的方案名称
        for scheme_name in level_scheme_relation.get(level_name, []):
            # 查找方案序号
            for scheme in scheme_list:
                if scheme.get('名称') == scheme_name:
                    scheme_serial += str(scheme.get('序号', ''))
                    break

        return scheme_serial.strip()

    def validate_fields(
        self,
        data: Dict[str, Any],
        required_fields: List[str]
    ) -> Dict[str, Any]:
        """
        验证字段完整性，补充缺失字段

        Args:
            data: 待验证的数据字典
            required_fields: 必需字段列表

        Returns:
            验证后的数据字典（补充缺失字段）
        """
        # 检查是否所有必需字段都存在
        for field in required_fields:
            if field not in data:
                # 补充缺失字段，填空字符串
                data[field] = {
                    'value': '',
                    'badcase_type': ''
                }

        return data

    def validate_liability_fields(
        self,
        liability_list: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        验证保险责任字段完整性

        Args:
            liability_list: 保险责任数据列表

        Returns:
            验证后的保险责任数据列表
        """
        # 定义保险责任的必需字段(29个字段)
        required_fields = [
            'level_name',  # 层级名称
            'scheme_serial_number',  # 方案序号
            'types_of_insurance',  # 保险种类
            'insurance_liability',  # 保险责任
            'variable_item',  # 浮动项
            'insurance_coverage_amount',  # 保额
            'per_claim_deductible',  # 次免赔额
            'daily_deductible',  # 日免赔额
            'annual_deductible',  # 年免赔额
            'per_claim_limit',  # 次限额
            'daily_limit',  # 日限额
            'annual_limit',  # 年限额
            'shared_or_not',  # 是否共用
            'claim_payment_method',  # 赔付方式
            'claim_payment_ratio_with_medical_insurance',  # 赔付比例（有医保）
            'claim_payment_ratio_without_medical_insurance',  # 赔付比例（无医保）
            'claim_coverage_class_A',  # 赔付内容（甲类）
            'claim_coverage_class_B_drugs',  # 赔付内容（乙类药）
            'claim_coverage_class_B_medical_services',  # 赔付内容（乙类诊疗）
            'claim_coverage_self_funded',  # 赔付内容（自费）
            'designated_hospital',  # 指定医院
            'scheme_special_agreement'  # 方案特约
        ]

        # 验证每个保险责任数据
        for item in liability_list:
            # 将字段转换为{value: '', badcase_type: ''}格式
            for field in required_fields:
                if field not in item:
                    # 补充缺失字段
                    item[field] = {
                        'value': '',
                        'badcase_type': ''
                    }
                elif not isinstance(item[field], dict):
                    # 如果字段值不是字典格式，转换为标准格式
                    item[field] = {
                        'value': str(item[field]) if item[field] else '',
                        'badcase_type': ''
                    }

        return liability_list

    def extract_json_structure(self, text: str) -> Optional[Dict[str, Any]]:
        """
        从文本中提取JSON结构

        Args:
            text: 包含JSON结构的文本

        Returns:
            提取到的JSON数据，如果提取失败返回None
        """
        try:
            # 去除空格和换行
            content = text.replace("\n", '').replace(" ", '')

            # 1. 匹配代码块标记（```python 或 ```json）
            code_block_pattern = re.compile(
                r'```(?:python|json)\s*([\s\S]*?)\s*```',
                re.IGNORECASE
            )
            code_blocks = code_block_pattern.findall(content)
            candidates = code_blocks if code_blocks else [content]

            # 2. 匹配可能的JSON结构（支持带result=前缀）
            json_pattern = re.compile(
                r'(?:result\s*=\s*)?('
                # 匹配字典（支持嵌套）
                r'\{'
                r'(?:[^{}"\']|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|'
                r'{(?:[^{}"\']|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|{(?:[^{}"\']|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\')*})*})*'
                r'}'
                r'|'
                # 匹配列表（支持嵌套）
                r'\['
                r'(?:[^\[\]"\\]|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|'
                r'{(?:[^{}"\']|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|{(?:[^{}"\']|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\')*})*}|'
                r'\[(?:[^\[\]"\\]|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|\[(?:[^\[\]"\\]|"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\'|\]\])*\])*\]'
                r')',
                re.DOTALL
            )

            for candidate in candidates:
                matches = json_pattern.findall(candidate)
                for match in matches:
                    try:
                        # 3. 格式修复（将Python格式转换为标准JSON格式）
                        processed = match.strip()
                        # 替换单引号为双引号
                        processed = re.sub(r"(?<!\\)'", '"', processed)
                        # 修复键名缺少引号的问题
                        processed = re.sub(
                            r'(?<=[{\s,])\s*([a-zA-Z0-9_一-龥]+)\s*:',
                            r' "\1":',
                            processed
                        )
                        # 移除尾部多余的逗号
                        processed = re.sub(r',\s*([}\]])', r' \1', processed)
                        # 处理换行和多余空格
                        processed = re.sub(r'\s+', ' ', processed)

                        # 4. 使用json模块解析
                        data = json.loads(processed)

                        # 验证是否为字典或列表
                        if isinstance(data, (dict, list)):
                            return data
                    except json.JSONDecodeError:
                        # 解析失败时继续尝试下一个匹配
                        continue

            # 未找到有效结构
            return None

        except Exception as e:
            print(f"提取JSON结构时出错: {str(e)}")
            return None

    def clean_text_content(self, text: str) -> str:
        """
        清理文本内容，去除多余空格、换行

        Args:
            text: 待清理的文本

        Returns:
            清理后的文本
        """
        if not text:
            return ''

        # 去除<page>标签
        cleaned = re.sub(r'</?page[^>]*>', '', text)

        # 合并多余空行
        cleaned = re.sub(r'\n+', '\n', cleaned)

        # 去除前后空格
        cleaned = cleaned.strip()

        return cleaned

    def split_by_scheme(self, text: str, scheme_list: List[Dict[str, str]]) -> Dict[str, str]:
        """
        按方案分割文本内容

        Args:
            text: 待分割的文本
            scheme_list: 方案列表，格式如 [{'名称': '方案A', '序号': '01'}, ...]

        Returns:
            方案名称到内容的映射字典
        """
        result = {}

        # 按行分割文本
        lines = text.split('\n')
        total_lines = len(lines)

        # 为每个方案找到起始行号
        scheme_positions = []
        for scheme in scheme_list:
            scheme_name = scheme["名称"]
            scheme_no = str(scheme["序号"])
            start_line = -1

            # 遍历每行文本查找匹配
            for i, line in enumerate(lines):
                # 正则匹配包含方案序号和名称的行
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

        # 确定每个方案的结束行号并提取内容
        for i in range(scheme_count):
            current = scheme_positions[i]
            current_name = current["name"]
            current_start = current["start"]

            # 确定结束行：下一个方案的起始行或最后一行
            if i < scheme_count - 1:
                current_end = scheme_positions[i + 1]["start"] - 1
            else:
                current_end = total_lines - 1

            # 提取方案内容（包含起始行到结束行）
            content_lines = lines[current_start:current_end + 1]
            scheme_content = ''.join(content_lines).rstrip('\n')

            # 去掉方案内部的\n和空格
            scheme_content = scheme_content.replace('\n', '').replace(' ', '')

            result[current_name] = scheme_content

        return result


def create_data_processor() -> DataProcessor:
    """
    创建数据处理器实例

    Returns:
        DataProcessor实例
    """
    return DataProcessor()