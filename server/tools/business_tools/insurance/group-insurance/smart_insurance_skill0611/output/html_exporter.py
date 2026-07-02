"""
Smart Insurance Skill 0611 - HTML报告生成器

生成保单解读详情HTML页面，包含：
- 保单基本信息表格
- 保险责任表格（支持合并单元格）
- 团单特约表格
- 个人特约表格
- 其他特约表格

支持功能：
- Excel风格表格
- 可编辑单元格
- 数据筛选
- 修改标记
"""

import json
import os
from typing import Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime


class HTMLExporter:
    """
    HTML报告生成器 - 生成保单解读详情HTML页面

    使用示例:
        exporter = HTMLExporter()
        html_content = exporter.generate(data, task_id='T001')
        exporter.save(html_content, './outputs/report.html')
    """

    def __init__(self):
        """初始化HTML导出器"""
        self.css_styles = self._get_css_styles()
        self.javascript = self._get_javascript()

    def generate(self, data: Dict[str, Any], task_id: str = '') -> str:
        """
        生成完整的HTML报告

        Args:
            data: 解读结果数据
            task_id: 任务ID

        Returns:
            HTML内容
        """
        html_parts = []

        # HTML头部
        html_parts.append(self._generate_html_head(task_id))

        # HTML主体
        html_parts.append('<body>')
        html_parts.append('<div class="container">')

        # 页面头部
        html_parts.append(self._generate_header(task_id))

        # 加载状态
        html_parts.append(self._generate_loading_error_states())

        # 内容区域
        html_parts.append('<div id="content" style="display: block;">')

        # 1. 保单基本信息
        if '保单基本信息' in data or 'basic_policy_information' in data or 'policy_basic_info' in data:
            basic_info = data.get('保单基本信息') or data.get('basic_policy_information') or data.get('policy_basic_info', {})
            html_parts.append(self._generate_basic_info_table(basic_info))

        # 2. 保险责任（最复杂的表格）
        insurance_liability = data.get('保险责任') or data.get('insurance_liability') or []
        if '方案信息' in data:
            # 从方案信息中提取保险责任
            for scheme_name, scheme_data in data['方案信息'].items():
                if '保险责任' in scheme_data:
                    insurance_liability.extend(scheme_data['保险责任'])

        if insurance_liability:
            html_parts.append(self._generate_insurance_liability_table(insurance_liability))

        # 3. 团单特约
        group_agreement = data.get('团单特约') or data.get('group_agreement') or data.get('group_contract_special_agreement', {})
        if group_agreement:
            html_parts.append(self._generate_group_agreement_table(group_agreement))

        # 4. 个人特约
        personal_agreement = data.get('个人特约') or data.get('personal_agreement') or data.get('personal_contract_special_agreement', [])
        html_parts.append(self._generate_personal_agreement_table(personal_agreement))

        # 5. 其他特约
        other_agreement = data.get('其他特约') or data.get('other_agreement') or data.get('other_special_agreements', [])
        html_parts.append(self._generate_other_agreement_table(other_agreement))

        html_parts.append('</div>')  # content
        html_parts.append('</div>')  # container
        html_parts.append('</body>')

        # 编辑弹窗
        html_parts.append(self._generate_edit_modal())

        # JavaScript脚本
        html_parts.append(f'<script>{self.javascript}</script>')

        html_parts.append('</html>')

        return '\n'.join(html_parts)

    def _generate_html_head(self, task_id: str) -> str:
        """生成HTML头部"""
        return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>保单解读详情 - {task_id}</title>
    <style>
{self.css_styles}
    </style>
</head>'''

    def _generate_header(self, task_id: str) -> str:
        """生成页面头部"""
        return f'''<div class="header">
    <div>
        <h1 style="font-size: 20px; font-weight: bold; color: #1f2937; margin: 0;">保单解读详情</h1>
        <p class="text-sm text-gray-600 mt-1">任务ID: <span id="task-id">{task_id}</span></p>
    </div>
    <div style="display: flex; gap: 8px;">
        <button onclick="window.close()" class="back-btn" style="display: flex; align-items: center; background-color: #6b7280;">
            <i class="fas fa-times" style="margin-right: 6px;"></i>关闭
        </button>
    </div>
</div>'''

    def _generate_loading_error_states(self) -> str:
        """生成加载和错误状态"""
        return '''<div id="loading" class="loading" style="display: none;">
    <i class="fas fa-spinner fa-spin mr-2"></i>正在加载数据...
</div>
<div id="error" class="error" style="display: none;">
    <i class="fas fa-exclamation-circle mr-2"></i>
    <span id="error-message"></span>
</div>'''

    def _generate_basic_info_table(self, basic_info: Dict[str, Any]) -> str:
        """
        生成保单基本信息表格

        Args:
            basic_info: 保单基本信息字典

        Returns:
            HTML表格字符串
        """
        # 字段顺序和中文映射
        field_order = [
            ('投保单位名称', 'name_of_the_insuring_entity'),
            ('投保单号/保单号', 'policy_number'),
            ('保险期间', 'insurance_period'),
            ('等待期', 'waiting_period'),
            ('保险来源', 'insurance_source'),
            ('险种类别', 'insurance_category'),
            ('保单状态', 'policy_status')
        ]

        rows_html = []
        for cn_name, en_name in field_order:
            # 支持中英文字段名
            value = basic_info.get(cn_name) or basic_info.get(en_name) or ''

            # 处理值格式
            if isinstance(value, dict) and 'value' in value:
                display_value = value.get('value', '')
                badcase_type = value.get('badcase_type', '')
                is_modified = badcase_type != ''
            else:
                display_value = str(value) if value else ''
                is_modified = False

            modified_class = 'modified' if is_modified else ''
            editable_class = 'editable-cell'

            rows_html.append(f'''<tr data-field="{en_name}" data-section="basic_policy_information">
    <td class="header-row">{cn_name}</td>
    <td class="{editable_class} {modified_class}" style="cursor: pointer;">{display_value}</td>
</tr>''')

        return f'''<div class="section-title">保单基本信息</div>
<div class="table-container">
    <table class="excel-table">
        <colgroup>
            <col style="width: 20%;">
            <col style="width: 80%;">
        </colgroup>
        <tbody>
{"".join(rows_html)}
        </tbody>
    </table>
</div>'''

    def _generate_insurance_liability_table(self, insurance_liability: List[Dict]) -> str:
        """
        生成保险责任表格（最复杂，支持合并单元格）

        Args:
            insurance_liability: 保险责任列表

        Returns:
            HTML表格字符串
        """
        if not insurance_liability:
            return ''

        # 获取层级名称列表（用于筛选）
        level_names = []
        for item in insurance_liability:
            level_name = item.get('层级名称') or item.get('level_name') or ''
            if level_name and level_name not in level_names:
                level_names.append(level_name)

        # 生成筛选下拉框
        filter_options = '<option value="">全部</option>'
        for name in level_names:
            filter_options += f'<option value="{name}">{name}</option>'

        # 合并数据（按层级名称和方案序号）
        merged_data = self._merge_insurance_liability(insurance_liability)

        # 分析指定医院和方案特约列（用于合并）
        analysis = self._analyze_hospitals_and_agreements(merged_data)

        # 生成表头
        table_header = '''<thead>
    <tr>
        <th rowspan="2" class="center-align">层级名称</th>
        <th rowspan="2" class="center-align">方案序号</th>
        <th rowspan="2" class="center-align">保险种类</th>
        <th rowspan="2" class="center-align">保险责任</th>
        <th rowspan="2" class="center-align">保额</th>
        <th rowspan="2" class="center-align">公用关系</th>
        <th rowspan="2" class="center-align">免赔额</th>
        <th rowspan="2" class="center-align">限额</th>
        <th colspan="2" class="center-align">赔付比例</th>
        <th colspan="4" class="center-align">赔付内容</th>
        <th rowspan="2" class="center-align">指定医院</th>
        <th rowspan="2" class="center-align">方案特约</th>
    </tr>
    <tr>
        <th class="center-align">有医保</th>
        <th class="center-align">无医保</th>
        <th class="center-align">甲类</th>
        <th class="center-align">乙类</th>
        <th class="center-align" style="width: 180px !important;">乙类诊疗</th>
        <th class="center-align">自费</th>
    </tr>
</thead>'''

        # 生成表格行
        table_rows = self._generate_insurance_rows(merged_data, analysis)

        return f'''<div class="section-title">保险责任</div>
<div class="mb-4">
    <label for="level-filter" class="text-sm font-medium text-gray-700 mr-2">层级名称筛选:</label>
    <select id="level-filter" class="border border-gray-300 rounded px-3 py-1 text-sm" onchange="filterByLevel(this.value)">
        {filter_options}
    </select>
</div>
<div class="table-container">
    <table id="insurance-table" class="excel-table">
        <colgroup>
            <col style="width: 80px;">
            <col style="width: 80px;">
            <col style="width: 190px;">
            <col style="width: 230px;">
            <col style="width: 110px;">
            <col style="width: 170px;">
            <col style="width: 80px;">
            <col style="width: 80px;">
            <col style="width: 50px;">
            <col style="width: 50px;">
            <col style="width: 50px;">
            <col style="width: 50px;">
            <col style="width: 60px;">
            <col style="width: 50px;">
            <col style="width: 150px;">
            <col style="width: 150px;">
        </colgroup>
        {table_header}
        <tbody>
{table_rows}
        </tbody>
    </table>
</div>'''

    def _merge_insurance_liability(self, data: List[Dict]) -> List[Dict]:
        """合并保险责任数据（按层级名称和方案序号）"""
        if not data:
            return []

        groups = {}

        for item in data:
            level_name = item.get('层级名称') or item.get('level_name') or ''
            scheme_number = item.get('方案序号') or item.get('scheme_serial_number') or ''

            key = f"{level_name}-{scheme_number}"

            if key not in groups:
                groups[key] = {
                    'level_name': level_name,
                    'scheme_number': scheme_number,
                    'items': []
                }

            groups[key]['items'].append(item)

        merged = []
        for group in groups.values():
            if len(group['items']) == 1:
                merged.append(group['items'][0])
            else:
                first_item = group['items'][0]
                first_item['rowSpan'] = len(group['items'])
                first_item['subItems'] = group['items'][1:]
                merged.append(first_item)

        return merged

    def _analyze_hospitals_and_agreements(self, merged_data: List[Dict]) -> Dict:
        """分析指定医院和方案特约列，用于合并"""
        all_rows = []

        for item in merged_data:
            if 'rowSpan' in item and 'subItems' in item:
                all_rows.append({'data': item, 'is_main': True})
                for sub_item in item['subItems']:
                    all_rows.append({'data': sub_item, 'is_sub': True})
            else:
                all_rows.append({'data': item, 'is_single': True})

        # 分析指定医院列
        hospital_merge_info = {}
        current_value = None
        current_start = 0
        current_count = 0

        for idx, row in enumerate(all_rows):
            hospital = self._extract_value(row['data'].get('指定医院') or row['data'].get('designated_hospital'))

            if hospital == current_value:
                current_count += 1
            else:
                if current_count > 1:
                    for i in range(current_start, current_start + current_count):
                        hospital_merge_info[i] = {
                            'rowspan': current_count,
                            'isFirst': i == current_start
                        }
                current_value = hospital
                current_start = idx
                current_count = 1

        if current_count > 1:
            for i in range(current_start, current_start + current_count):
                hospital_merge_info[i] = {
                    'rowspan': current_count,
                    'isFirst': i == current_start
                }

        # 分析方案特约列
        agreement_merge_info = {}
        current_value = None
        current_start = 0
        current_count = 0

        for idx, row in enumerate(all_rows):
            agreement = self._extract_value(row['data'].get('方案特约') or row['data'].get('scheme_special_agreement'))

            if agreement == current_value:
                current_count += 1
            else:
                if current_count > 1:
                    for i in range(current_start, current_start + current_count):
                        agreement_merge_info[i] = {
                            'rowspan': current_count,
                            'isFirst': i == current_start
                        }
                current_value = agreement
                current_start = idx
                current_count = 1

        if current_count > 1:
            for i in range(current_start, current_start + current_count):
                agreement_merge_info[i] = {
                    'rowspan': current_count,
                    'isFirst': i == current_start
                }

        return {
            'all_rows': all_rows,
            'hospital_merge_info': hospital_merge_info,
            'agreement_merge_info': agreement_merge_info
        }

    def _generate_insurance_rows(self, merged_data: List[Dict], analysis: Dict) -> str:
        """生成保险责任表格行"""
        rows_html = []

        for idx, row_info in enumerate(analysis['all_rows']):
            item = row_info['data']
            hospital_info = analysis['hospital_merge_info'].get(idx)
            agreement_info = analysis['agreement_merge_info'].get(idx)

            row_html = '<tr>'

            # 层级名称和方案序号（合并单元格）
            show_level = row_info.get('is_main') or row_info.get('is_single')
            if show_level:
                if row_info.get('is_main') and 'rowSpan' in item:
                    row_span = item['rowSpan']
                    level_name = self._extract_value(item.get('层级名称') or item.get('level_name'))
                    scheme_number = self._extract_value(item.get('方案序号') or item.get('scheme_serial_number'))
                    row_html += f'<td class="merged-cell center-align" rowspan="{row_span}">{level_name}</td>'
                    row_html += f'<td class="merged-cell center-align" rowspan="{row_span}">{scheme_number}</td>'
                else:
                    level_name = self._extract_value(item.get('层级名称') or item.get('level_name'))
                    scheme_number = self._extract_value(item.get('方案序号') or item.get('scheme_serial_number'))
                    row_html += f'<td class="merged-cell center-align">{level_name}</td>'
                    row_html += f'<td class="merged-cell center-align">{scheme_number}</td>'

            # 其他列
            insurance_type = self._extract_value(item.get('保险种类') or item.get('types_of_insurance'))
            liability = self._extract_value(item.get('保险责任') or item.get('insurance_liability'))
            amount = self._extract_value(item.get('保额') or item.get('insurance_coverage_amount'))
            shared = self._extract_value(item.get('公用关系') or item.get('shared_or_not'))

            row_html += f'<td class="center-align editable-cell">{insurance_type}</td>'
            row_html += f'<td class="center-align editable-cell">{liability}</td>'
            row_html += f'<td class="center-align editable-cell">{amount}</td>'
            row_html += f'<td class="center-align editable-cell">{shared}</td>'

            # 赔付方式有值时合并单元格
            payment_method = self._extract_value(item.get('claim_payment_method') or item.get('payment_method'))
            has_payment = payment_method and payment_method != '-' and payment_method != ''

            if has_payment:
                # 合并免赔额、限额、赔付比例、赔付内容列（共8列）
                payment_info = self._format_payment_info(item)
                row_html += f'<td class="multi-line center-align editable-cell" colspan="8" style="background-color: #f5f5f5;">{payment_info}</td>'
            else:
                # 分别显示各列
                deductible = self._format_deductible(item)
                limit = self._format_limit(item)

                ratio_with = self._extract_value(item.get('赔付比例（有医保）') or item.get('claim_payment_ratio_with_medical_insurance'))
                ratio_without = self._extract_value(item.get('赔付比例（无医保）') or item.get('claim_payment_ratio_without_medical_insurance'))

                coverage_a = self._extract_value(item.get('赔付内容（甲类）') or item.get('claim_coverage_class_A'))
                coverage_b_drug = self._extract_value(item.get('赔付内容（乙类药）') or item.get('claim_coverage_class_B_drugs'))
                coverage_b_medical = self._extract_value(item.get('赔付内容（乙类诊疗）') or item.get('claim_coverage_class_B_medical_services'))
                coverage_self = self._extract_value(item.get('赔付内容（自费）') or item.get('claim_coverage_self_funded'))

                row_html += f'<td class="multi-line center-align editable-cell">{deductible}</td>'
                row_html += f'<td class="multi-line center-align editable-cell">{limit}</td>'
                row_html += f'<td class="center-align editable-cell">{ratio_with}</td>'
                row_html += f'<td class="center-align editable-cell">{ratio_without}</td>'
                row_html += f'<td class="center-align editable-cell">{coverage_a}</td>'
                row_html += f'<td class="center-align editable-cell">{coverage_b_drug}</td>'
                row_html += f'<td class="center-align editable-cell" style="width: 180px !important;">{coverage_b_medical}</td>'
                row_html += f'<td class="center-align editable-cell">{coverage_self}</td>'

            # 指定医院列（合并）
            if hospital_info and hospital_info['isFirst']:
                hospital_value = self._extract_value(item.get('指定医院') or item.get('designated_hospital'))
                row_html += f'<td class="merged-cell hospital-column editable-cell" rowspan="{hospital_info["rowspan"]}">{hospital_value}</td>'
            elif not hospital_info:
                hospital_value = self._extract_value(item.get('指定医院') or item.get('designated_hospital'))
                row_html += f'<td class="hospital-column editable-cell">{hospital_value}</td>'

            # 方案特约列（合并）
            if agreement_info and agreement_info['isFirst']:
                agreement_value = self._extract_value(item.get('方案特约') or item.get('scheme_special_agreement'))
                row_html += f'<td class="merged-cell scheme-agreement-column editable-cell" rowspan="{agreement_info["rowspan"]}">{agreement_value}</td>'
            elif not agreement_info:
                agreement_value = self._extract_value(item.get('方案特约') or item.get('scheme_special_agreement'))
                row_html += f'<td class="scheme-agreement-column editable-cell">{agreement_value}</td>'

            row_html += '</tr>'
            rows_html.append(row_html)

        return '\n'.join(rows_html)

    def _generate_group_agreement_table(self, group_agreement: Dict) -> str:
        """生成团单特约表格"""
        field_order = [
            ('既往症', 'pre_existing_condition'),
            ('是否持卡', 'card_holding_status'),
            ('特需就诊', 'special_needs_outpatient_service'),
            ('职业类别', 'job_category'),
            ('特殊计算', 'special_calculation'),
            ('药量控制', 'medication_dosage_control'),
            ('门特/门慢的特殊规则', 'chronic_disease_outpatient_services')
        ]

        rows_html = []
        for cn_name, en_name in field_order:
            value = group_agreement.get(cn_name) or group_agreement.get(en_name) or ''

            if isinstance(value, dict) and 'value' in value:
                display_value = value.get('value', '')
            else:
                display_value = str(value) if value else ''

            rows_html.append(f'''<tr data-field="{en_name}" data-section="group_contract_special_agreement">
    <td class="header-row">{cn_name}</td>
    <td class="editable-cell" style="cursor: pointer;">{display_value}</td>
</tr>''')

        return f'''<div class="section-title">团单特约</div>
<div class="table-container">
    <table class="excel-table">
        <colgroup>
            <col style="width: 20%;">
            <col style="width: 80%;">
        </colgroup>
        <tbody>
{"".join(rows_html)}
        </tbody>
    </table>
</div>'''

    def _generate_personal_agreement_table(self, personal_agreement: List[Dict]) -> str:
        """生成个人特约表格"""
        rows_html = []

        for idx, item in enumerate(personal_agreement):
            name = item.get('姓名') or item.get('name') or ''
            id_card = item.get('身份证号') or item.get('id_card_number') or ''
            agreement = item.get('个人特约') or item.get('personal_agreement') or ''

            rows_html.append(f'''<tr>
    <td class="center-align">{idx + 1}</td>
    <td class="center-align editable-cell">{name}</td>
    <td class="center-align editable-cell">{id_card}</td>
    <td class="editable-cell">{agreement}</td>
</tr>''')

        return f'''<div class="section-title">个人特约</div>
<div class="table-container">
    <table class="excel-table">
        <colgroup>
            <col style="width: 8%;">
            <col style="width: 15%;">
            <col style="width: 20%;">
            <col style="width: 57%;">
        </colgroup>
        <thead>
            <tr>
                <th class="center-align">序号</th>
                <th class="center-align">姓名</th>
                <th class="center-align">身份证号</th>
                <th>个人特约</th>
            </tr>
        </thead>
        <tbody>
{"".join(rows_html)}
        </tbody>
    </table>
</div>'''

    def _generate_other_agreement_table(self, other_agreement: List[Dict]) -> str:
        """生成其他特约表格"""
        rows_html = []

        for item in other_agreement:
            serial = item.get('序号') or item.get('serial_number') or ''
            content = item.get('特约内容') or item.get('special_agreement_content') or ''

            rows_html.append(f'''<tr>
    <td class="merged-cell center-align editable-cell">{serial}</td>
    <td class="editable-cell">{content}</td>
</tr>''')

        return f'''<div class="section-title">其他特约</div>
<div class="table-container">
    <table class="excel-table">
        <colgroup>
            <col style="width: 10%;">
            <col style="width: 90%;">
        </colgroup>
        <thead>
            <tr>
                <th class="center-align">序号</th>
                <th>特约内容</th>
            </tr>
        </thead>
        <tbody>
{"".join(rows_html)}
        </tbody>
    </table>
</div>'''

    def _generate_edit_modal(self) -> str:
        """生成编辑弹窗"""
        return '''<!-- Edit Modal -->
<div id="edit-modal" class="edit-modal">
    <div class="edit-modal-content">
        <div class="edit-modal-header">
            <i class="fas fa-edit mr-2"></i>编辑内容
        </div>
        <div class="edit-modal-body">
            <div class="form-group">
                <label for="edit-textarea">
                    <i class="fas fa-pen mr-1"></i>内容
                </label>
                <textarea id="edit-textarea" placeholder="请输入内容..."></textarea>
            </div>
        </div>
        <div class="edit-modal-footer">
            <button class="btn-cancel" onclick="closeEditModal()">
                <i class="fas fa-times mr-1"></i>取消
            </button>
            <button class="btn-save" onclick="saveEdit()">
                <i class="fas fa-check mr-1"></i>保存
            </button>
        </div>
    </div>
</div>'''

    def _extract_value(self, field) -> str:
        """提取字段值"""
        if field is None or field == '':
            return ''

        if isinstance(field, dict) and 'value' in field:
            value = field['value']
            return str(value) if value else ''

        if isinstance(field, list):
            return ', '.join([str(v) for v in field if v])

        return str(field)

    def _format_deductible(self, item: Dict) -> str:
        """格式化免赔额"""
        values = []

        per_claim = self._extract_value(item.get('次免赔额') or item.get('per_claim_deductible'))
        daily = self._extract_value(item.get('日免赔额') or item.get('daily_deductible'))
        annual = self._extract_value(item.get('年免赔额') or item.get('annual_deductible'))

        if per_claim:
            values.append(f'次: {per_claim}')
        if daily:
            values.append(f'日: {daily}')
        if annual:
            values.append(f'年: {annual}')

        return '\n'.join(values) if values else '-'

    def _format_limit(self, item: Dict) -> str:
        """格式化限额"""
        values = []

        per_claim = self._extract_value(item.get('次限额') or item.get('per_claim_limit'))
        daily = self._extract_value(item.get('日限额') or item.get('daily_limit'))
        annual = self._extract_value(item.get('年限额') or item.get('annual_limit'))

        if per_claim:
            values.append(f'次: {per_claim}')
        if daily:
            values.append(f'日: {daily}')
        if annual:
            values.append(f'年: {annual}')

        return '\n'.join(values) if values else '-'

    def _format_payment_info(self, item: Dict) -> str:
        """格式化赔付信息"""
        values = []

        # 赔付方式
        payment_method = self._extract_value(item.get('claim_payment_method') or item.get('payment_method'))
        if payment_method:
            values.append(payment_method)

        # 免赔额
        deductible = self._format_deductible(item)
        if deductible != '-':
            values.append(f'免赔额:\n{deductible}')

        # 限额
        limit = self._format_limit(item)
        if limit != '-':
            values.append(f'限额:\n{limit}')

        return '\n'.join(values) if values else '-'

    def save(self, html_content: str, output_path: str) -> str:
        """
        保存HTML文件

        Args:
            html_content: HTML内容
            output_path: 输出路径

        Returns:
            保存的文件路径
        """
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            f.write(html_content)

        return str(path)

    def _get_css_styles(self) -> str:
        """获取CSS样式"""
        return '''/* Excel-like table styles */
.excel-table {
    border-collapse: collapse;
    font-family: Arial, sans-serif;
    font-size: 12px;
    width: 100%;
    table-layout: fixed;
}

.excel-table th,
.excel-table td {
    border: 1px solid #d4d4d4;
    padding: 3px 5px;
    vertical-align: top;
    line-height: 1.2;
    word-wrap: break-word;
}

.excel-table th {
    background-color: #d1d5db;
    font-weight: bold;
    text-align: center;
    color: #333;
    position: sticky;
    top: 0;
    z-index: 10;
    white-space: nowrap !important;
    font-size: 12px;
    padding: 5px 8px !important;
    vertical-align: middle;
}

.excel-table tr:nth-child(even) {
    background-color: #f9f9f9;
}

.excel-table tr:hover {
    background-color: #e3f2fd !important;
}

.excel-table .merged-cell {
    background-color: #f8f9fa;
    vertical-align: middle;
    text-align: center;
}

.excel-table .center-align {
    text-align: center;
    vertical-align: middle;
}

.section-title {
    font-size: 16px;
    font-weight: bold;
    color: #333;
    margin: 20px 0 10px 0;
    padding-bottom: 5px;
    border-bottom: 2px solid #4CAF50;
}

body {
    background-color: #f5f5f5;
    margin: 0;
    padding: 20px;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    background-color: white;
    padding: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    padding-bottom: 15px;
    border-bottom: 2px solid #2196F3;
}

.back-btn {
    background-color: #2196F3;
    color: white;
    padding: 6px 16px;
    text-decoration: none;
    border-radius: 4px;
    transition: background-color 0.3s;
    font-size: 14px;
}

.back-btn:hover {
    background-color: #1976D2;
}

.multi-line {
    white-space: pre-line;
    font-size: 11px;
    line-height: 1.2;
}

.editable-cell {
    cursor: pointer;
    position: relative;
    transition: background-color 0.2s;
}

.editable-cell:hover {
    background-color: #f0f8ff !important;
}

.editable-cell.modified {
    background-color: #fff3cd !important;
    border: 1px solid #ffeaa7;
}

.edit-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: none;
    justify-content: center;
    align-items: center;
}

.edit-modal.show {
    display: flex;
}

.edit-modal-content {
    background-color: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    min-width: 450px;
    max-width: 550px;
}

.edit-modal textarea {
    width: 100%;
    min-height: 100px;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.5;
}

.edit-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
}

.edit-modal button {
    padding: 8px 20px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
}

.edit-modal .btn-cancel {
    background-color: #6c757d;
    color: white;
}

.edit-modal .btn-save {
    background-color: #007bff;
    color: white;
}

.hospital-column,
.scheme-agreement-column {
    max-width: 150px;
    white-space: pre-wrap;
    word-wrap: break-word;
}

.table-container {
    overflow-x: auto;
    margin-bottom: 20px;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
}

#insurance-table {
    min-width: 2000px;
}'''

    def _get_javascript(self) -> str:
        """获取JavaScript脚本"""
        return '''
function filterByLevel(level) {
    const table = document.getElementById('insurance-table');
    const rows = table.querySelectorAll('tbody tr');

    rows.forEach(row => {
        const levelCell = row.querySelector('td.merged-cell.center-align');
        if (level === '') {
            row.style.display = '';
        } else if (levelCell && levelCell.textContent === level) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function addEditableCellHandlers() {
    const cells = document.querySelectorAll('.editable-cell');
    cells.forEach(cell => {
        cell.addEventListener('click', function() {
            openEditModal(this);
        });
    });
}

function openEditModal(cell) {
    const modal = document.getElementById('edit-modal');
    const textarea = document.getElementById('edit-textarea');

    textarea.value = cell.textContent.trim();
    modal.classList.add('show');

    window.currentEditingCell = cell;
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('show');
}

function saveEdit() {
    const textarea = document.getElementById('edit-textarea');
    const cell = window.currentEditingCell;

    if (cell) {
        cell.textContent = textarea.value;
        cell.classList.add('modified');
    }

    closeEditModal();
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    addEditableCellHandlers();
});
'''