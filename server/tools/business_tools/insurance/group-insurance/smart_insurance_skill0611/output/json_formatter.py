"""
Smart Insurance Skill 0611 - JSON格式化器

标准化JSON输出格式，支持字段映射和验证
"""

import json
from typing import Dict, Any, List
from pathlib import Path
from datetime import datetime


class JSONFormatter:
    """
    JSON格式化器 - 标准化JSON输出格式

    使用示例:
        formatter = JSONFormatter()
        formatted_data = formatter.format(data)
        formatter.save(formatted_data, './outputs/result.json')
    """

    def __init__(self):
        """初始化JSON格式化器"""
        self.field_mappings = {
            # 保单基本信息
            '投保单位名称': 'name_of_the_insuring_entity',
            '团单号': 'policy_number',
            '保险期间': 'insurance_period',
            '等待期': 'waiting_period',

            # 团单特约
            '既往症': 'pre_existing_condition',
            '是否持卡': 'card_holding_status',
            '特需就诊': 'special_needs_outpatient_service',
            '职业类别': 'job_category',
            '特殊计算': 'special_calculation',
            '药量控制': 'medication_dosage_control',
            '门特/门慢的特殊规则': 'chronic_disease_outpatient_services',

            # 保险责任
            '层级名称': 'level_name',
            '方案序号': 'scheme_serial_number',
            '保险种类': 'types_of_insurance',
            '保险责任': 'insurance_liability',
            '保额': 'insurance_coverage_amount',
            '公用关系': 'shared_or_not',
            '指定医院': 'designated_hospital',
            '方案特约': 'scheme_special_agreement'
        }

    def format(self, data: Dict[str, Any], task_id: str = '', include_metadata: bool = True) -> Dict[str, Any]:
        """
        格式化数据为标准化JSON格式

        Args:
            data: 原始数据
            task_id: 任务ID
            include_metadata: 是否包含元数据

        Returns:
            格式化后的数据
        """
        formatted = {}

        # 1. 保单基本信息
        if '保单基本信息' in data or 'basic_policy_information' in data or 'policy_basic_info' in data:
            basic_info = data.get('保单基本信息') or data.get('basic_policy_information') or data.get('policy_basic_info', {})
            formatted['basic_policy_information'] = self._format_basic_info(basic_info)

        # 2. 团单特约
        if '团单特约' in data or 'group_agreement' in data or 'group_contract_special_agreement' in data:
            group_agreement = data.get('团单特约') or data.get('group_agreement') or data.get('group_contract_special_agreement', {})
            formatted['group_contract_special_agreement'] = self._format_group_agreement(group_agreement)

        # 3. 保险责任
        insurance_liability = data.get('保险责任') or data.get('insurance_liability') or []
        if '方案信息' in data:
            for scheme_name, scheme_data in data['方案信息'].items():
                if '保险责任' in scheme_data:
                    insurance_liability.extend(scheme_data['保险责任'])

        if insurance_liability:
            formatted['insurance_liability'] = self._format_insurance_liability(insurance_liability)

        # 4. 个人特约
        if '个人特约' in data or 'personal_agreement' in data or 'personal_contract_special_agreement' in data:
            personal_agreement = data.get('个人特约') or data.get('personal_agreement') or data.get('personal_contract_special_agreement', [])
            formatted['personal_contract_special_agreement'] = self._format_personal_agreement(personal_agreement)

        # 5. 其他特约
        if '其他特约' in data or 'other_agreement' in data or 'other_special_agreements' in data:
            other_agreement = data.get('其他特约') or data.get('other_agreement') or data.get('other_special_agreements', [])
            formatted['other_special_agreements'] = self._format_other_agreement(other_agreement)

        # 6. 元数据
        if include_metadata:
            formatted['metadata'] = {
                'task_id': task_id,
                'version': '1.0.0',
                'timestamp': datetime.now().isoformat(),
                'source': 'smart_insurance_skill0611'
            }

        return formatted

    def _format_basic_info(self, basic_info: Dict) -> Dict:
        """格式化保单基本信息"""
        formatted = {}

        field_order = [
            ('投保单位名称', 'name_of_the_insuring_entity'),
            ('投保单号/保单号', 'policy_number'),
            ('保险期间', 'insurance_period'),
            ('等待期', 'waiting_period'),
            ('保险来源', 'insurance_source'),
            ('险种类别', 'insurance_category'),
            ('保单状态', 'policy_status')
        ]

        for cn_name, en_name in field_order:
            value = basic_info.get(cn_name) or basic_info.get(en_name)

            if value:
                if isinstance(value, dict) and 'value' in value:
                    formatted[en_name] = {
                        'value': value.get('value'),
                        'badcase_type': value.get('badcase_type', '')
                    }
                else:
                    formatted[en_name] = {
                        'value': str(value),
                        'badcase_type': ''
                    }
            else:
                formatted[en_name] = {
                    'value': '',
                    'badcase_type': ''
                }

        return formatted

    def _format_group_agreement(self, group_agreement: Dict) -> Dict:
        """格式化团单特约"""
        formatted = {}

        field_order = [
            ('既往症', 'pre_existing_condition'),
            ('是否持卡', 'card_holding_status'),
            ('特需就诊', 'special_needs_outpatient_service'),
            ('职业类别', 'job_category'),
            ('特殊计算', 'special_calculation'),
            ('药量控制', 'medication_dosage_control'),
            ('门特/门慢的特殊规则', 'chronic_disease_outpatient_services')
        ]

        for cn_name, en_name in field_order:
            value = group_agreement.get(cn_name) or group_agreement.get(en_name)

            if value:
                if isinstance(value, dict) and 'value' in value:
                    formatted[en_name] = {
                        'value': value.get('value'),
                        'badcase_type': value.get('badcase_type', '')
                    }
                else:
                    formatted[en_name] = {
                        'value': str(value),
                        'badcase_type': ''
                    }
            else:
                formatted[en_name] = {
                    'value': '',
                    'badcase_type': ''
                }

        return formatted

    def _format_insurance_liability(self, insurance_liability: List) -> List[Dict]:
        """格式化保险责任"""
        formatted_list = []

        for item in insurance_liability:
            formatted_item = {}

            # 字段映射
            field_mappings = {
                '层级名称': 'level_name',
                '方案序号': 'scheme_serial_number',
                '保险种类': 'types_of_insurance',
                '保险责任': 'insurance_liability',
                '浮动项': 'variable_item',  # 新增
                '保额': 'insurance_coverage_amount',
                '次免赔额': 'per_claim_deductible',
                '日免赔额': 'daily_deductible',
                '年免赔额': 'annual_deductible',
                '次限额': 'per_claim_limit',  # 新增
                '日限额': 'daily_limit',  # 新增
                '年限额': 'annual_limit',  # 新增
                '是否共用': 'shared_or_not',  # 新增
                '赔付方式': 'claim_payment_method',  # 新增
                '赔付比例（有医保）': 'claim_payment_ratio_with_medical_insurance',  # 新增
                '赔付比例（无医保）': 'claim_payment_ratio_without_medical_insurance',  # 新增
                '赔付内容（甲类）': 'claim_coverage_class_A',  # 新增
                '赔付内容（乙类药）': 'claim_coverage_class_B_drugs',  # 新增
                '赔付内容（乙类诊疗）': 'claim_coverage_class_B_medical_services',  # 新增
                '赔付内容（自费）': 'claim_coverage_self_funded',  # 新增
                '指定医院': 'designated_hospital',
                '方案特约': 'scheme_special_agreement'
            }

            for cn_name, en_name in field_mappings.items():
                value = item.get(cn_name) or item.get(en_name)

                if value:
                    if isinstance(value, dict) and 'value' in value:
                        formatted_item[en_name] = {
                            'value': value.get('value'),
                            'badcase_type': value.get('badcase_type', '')
                        }
                    else:
                        formatted_item[en_name] = {
                            'value': str(value),
                            'badcase_type': ''
                        }
                else:
                    formatted_item[en_name] = {
                        'value': '',
                        'badcase_type': ''
                    }

            formatted_list.append(formatted_item)

        return formatted_list

    def _format_personal_agreement(self, personal_agreement: List) -> List[Dict]:
        """格式化个人特约"""
        formatted_list = []

        for item in personal_agreement:
            formatted_item = {}

            name = item.get('姓名') or item.get('name')
            id_card = item.get('身份证号') or item.get('id_card_number')
            agreement = item.get('个人特约') or item.get('personal_agreement')

            formatted_item['name'] = {
                'value': str(name) if name else '',
                'badcase_type': ''
            }

            formatted_item['id_card_number'] = {
                'value': str(id_card) if id_card else '',
                'badcase_type': ''
            }

            formatted_item['personal_agreement'] = {
                'value': str(agreement) if agreement else '',
                'badcase_type': ''
            }

            formatted_list.append(formatted_item)

        return formatted_list

    def _format_other_agreement(self, other_agreement: List) -> List[Dict]:
        """格式化其他特约"""
        formatted_list = []

        for item in other_agreement:
            formatted_item = {}

            serial = item.get('序号') or item.get('serial_number')
            content = item.get('特约内容') or item.get('special_agreement_content')

            formatted_item['serial_number'] = {
                'value': str(serial) if serial else '',
                'badcase_type': ''
            }

            formatted_item['special_agreement_content'] = {
                'value': str(content) if content else '',
                'badcase_type': ''
            }

            formatted_list.append(formatted_item)

        return formatted_list

    def save(self, data: Dict[str, Any], output_path: str, indent: int = 4) -> str:
        """
        保存JSON文件

        Args:
            data: JSON数据
            output_path: 输出路径
            indent: 缩进空格数

        Returns:
            输出文件路径
        """
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)

        return str(path)