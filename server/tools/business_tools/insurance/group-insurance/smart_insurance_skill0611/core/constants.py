"""
Smart Insurance Skill 0611 - 常量定义

定义所有提取规则、字段映射、模块规则等常量
"""

# 提取规则定义
EXTRACTION_RULES = {
    "basic_info": {
        "required_fields": ["投保单位名称", "团单号", "保险期间", "等待期"],
        "description": "保单基本信息提取规则"
    },
    "group_agreement": {
        "required_fields": ["既往症", "是否持卡", "特需就诊", "职业类别", "特殊计算", "药量控制", "门特/门慢的特殊规则"],
        "description": "团单特约提取规则"
    },
    "insurance_liability": {
        "required_fields": [
            "层级名称", "方案序号", "保险种类", "保险责任", "浮动项", "保额",
            "次免赔额", "日免赔额", "年免赔额", "次限额", "日限额", "年限额",
            "是否共用", "赔付方式", "赔付比例（有医保）", "赔付比例（无医保）",
            "赔付内容（甲类）", "赔付内容（乙类药）", "赔付内容（乙类诊疗）", "赔付内容（自费）",
            "指定医院", "方案特约"
        ],
        "description": "保险责任提取规则(29个字段)"
    }
}

# 模块提取规则定义（移植自原项目）
MODULE_EXTRACT_RULES = {
    "basic_info": {
        "title_pattern": r'团体人身保险保险单(?!-)',
        "description": "基础保单信息"
    },
    "case_relation": {
        "title_pattern": r'团体人身保险保险单-层级对应方案',
        "description": "层级与方案对应关系"
    },
    "group_agreement": {
        "title_pattern": r'团体人身保险保险单-团体特约',
        "description": "团体特约"
    },
    "personal_agreement": {
        "title_pattern": r'团体人身保险保险单-个人特约',
        "description": "个人特约"
    }
}

# 团单特约字段提取规则
GROUP_AGREEMENT_FIELDS = {
    "既往症": {
        "description": "既往症的描述内容",
        "priority": ["报价单", "合同"],
        "rule": "从'既往症'开始提取描述的全部内容，禁止只从'重大既往症'开始提取"
    },
    "是否持卡": {
        "description": "社保分割要求和持卡就诊的相关内容",
        "priority": ["报价单", "合同"],
        "rule": "提取社保分割和持卡就诊相关描述"
    },
    "特需就诊": {
        "description": "支持特需部、国际部、VIP就诊的特约",
        "priority": ["报价单", "合同"],
        "rule": "只能在普通部就诊或没有相关描述时填空字符串"
    },
    "职业类别": {
        "description": "职业类别限制",
        "priority": ["报价单", "合同"],
        "rule": "提取职业类别限制内容"
    },
    "特殊计算": {
        "description": "理赔时大小数值比较的相关描述",
        "priority": ["报价单", "合同"],
        "rule": "常见有子女、配偶等的理赔计算，没有相关描述时填空字符串"
    },
    "药量控制": {
        "description": "药量使用、药品用量限制",
        "priority": ["报价单", "合同"],
        "rule": "提取药品限制相关内容，没有相关描述时填空字符串"
    },
    "门特/门慢的特殊规则": {
        "description": "门急诊、住院中慢性病、特种疾病的理赔规则",
        "priority": ["报价单", "合同"],
        "rule": "没有相关描述时填空字符串"
    }
}

# 基础信息字段提取规则
BASIC_INFO_FIELDS = {
    "投保单位名称": {
        "source": "合同",
        "description": "投保单位名称"
    },
    "团单号": {
        "source": "合同",
        "description": "团单编号"
    },
    "保险期间": {
        "source": "合同",
        "description": "保险期间"
    },
    "等待期": {
        "source": "合同",
        "description": "等待期"
    }
}

# 字段中英文映射
FIELD_MAPPINGS = {
    "cn_to_en": {
        # 保单基本信息(4个字段) - 对齐保险字段中英文对照表
        "投保单位名称": "name_of_the_insuring_entity",
        "团单号": "policy_number",
        "保险期间": "insurance_period",
        "等待期": "waiting_period",

        # 团单特约(7个字段) - 对齐保险字段中英文对照表
        "既往症": "pre_existing_condition",
        "是否持卡": "card_holding_status",
        "特需就诊": "special_needs_outpatient_service",
        "职业类别": "job_category",
        "特殊计算": "special_calculation",
        "药量控制": "medication_dosage_control",
        "门特/门慢的特殊规则": "chronic_disease_outpatient_services",

        # 保险责任(29个字段) - 完整字段映射
        "层级名称": "level_name",
        "方案序号": "scheme_serial_number",
        "保险种类": "types_of_insurance",
        "保险责任": "insurance_liability",
        "浮动项": "variable_item",  # 新增
        "保额": "insurance_coverage_amount",
        "次免赔额": "per_claim_deductible",
        "日免赔额": "daily_deductible",
        "年免赔额": "annual_deductible",
        "次限额": "per_claim_limit",  # 新增
        "日限额": "daily_limit",  # 新增
        "年限额": "annual_limit",  # 新增
        "是否共用": "shared_or_not",  # 新增
        "赔付方式": "claim_payment_method",  # 新增
        "赔付比例（有医保）": "claim_payment_ratio_with_medical_insurance",  # 新增
        "赔付比例（无医保）": "claim_payment_ratio_without_medical_insurance",  # 新增
        "赔付内容（甲类）": "claim_coverage_class_A",  # 新增
        "赔付内容（乙类药）": "claim_coverage_class_B_drugs",  # 新增
        "赔付内容（乙类诊疗）": "claim_coverage_class_B_medical_services",  # 新增
        "赔付内容（自费）": "claim_coverage_self_funded",  # 新增
        "指定医院": "designated_hospital",
        "方案特约": "scheme_special_agreement",

        # 个人特约(3个字段)
        "姓名": "name",
        "身份证号": "ID_card_number",
        "个人特约": "personal_special_agreement",

        # 其他特约(2个字段)
        "序号": "sequence_number",
        "特约内容": "special_agreement_details"
    },
    "en_to_cn": {
        # 保单基本信息
        "name_of_the_insuring_entity": "投保单位名称",
        "policy_number": "团单号",
        "insurance_period": "保险期间",
        "waiting_period": "等待期",

        # 团单特约
        "pre_existing_condition": "既往症",
        "card_holding_status": "是否持卡",
        "special_needs_outpatient_service": "特需就诊",
        "job_category": "职业类别",
        "special_calculation": "特殊计算",
        "medication_dosage_control": "药量控制",
        "chronic_disease_outpatient_services": "门特/门慢的特殊规则",

        # 保险责任
        "level_name": "层级名称",
        "scheme_serial_number": "方案序号",
        "types_of_insurance": "保险种类",
        "insurance_liability": "保险责任",
        "variable_item": "浮动项",
        "insurance_coverage_amount": "保额",
        "per_claim_deductible": "次免赔额",
        "daily_deductible": "日免赔额",
        "annual_deductible": "年免赔额",
        "per_claim_limit": "次限额",
        "daily_limit": "日限额",
        "annual_limit": "年限额",
        "shared_or_not": "是否共用",
        "claim_payment_method": "赔付方式",
        "claim_payment_ratio_with_medical_insurance": "赔付比例（有医保）",
        "claim_payment_ratio_without_medical_insurance": "赔付比例（无医保）",
        "claim_coverage_class_A": "赔付内容（甲类）",
        "claim_coverage_class_B_drugs": "赔付内容（乙类药）",
        "claim_coverage_class_B_medical_services": "赔付内容（乙类诊疗）",
        "claim_coverage_self_funded": "赔付内容（自费）",
        "designated_hospital": "指定医院",
        "scheme_special_agreement": "方案特约",

        # 个人特约
        "name": "姓名",
        "ID_card_number": "身份证号",
        "personal_special_agreement": "个人特约",

        # 其他特约
        "sequence_number": "序号",
        "special_agreement_details": "特约内容"
    }
}

# MCP工具名称定义
MCP_TOOL_NAMES = {
    "vision_classify": "vision_classify_page",  # 页面分类
    "vision_extract_text": "vision_extract_text",  # 文本抽取
    "vision_extract_table": "vision_extract_table",  # 表格抽取
    "vision_extract_coordinate": "vision_extract_coordinate",  # 坐标定位
    "vision_extract_quotation": "vision_extract_quotation",  # 报价单提取
    "llm_infer": "llm_infer",  # LLM推理
    "llm_extract": "llm_extract",  # LLM提取
    "llm_generate": "llm_generate"  # LLM生成
}

# 提取轮次配置
EXTRACTION_ROUNDS = {
    "liability_extraction": {
        "max_rounds": 5,
        "description": "保险责任多轮推理"
    }
}

# 输出格式定义
OUTPUT_FORMATS = {
    "json": {
        "extension": ".json",
        "description": "JSON格式"
    },
    "excel": {
        "extension": ".xlsx",
        "description": "Excel格式"
    },
    "markdown": {
        "extension": ".md",
        "description": "Markdown格式"
    }
}

# 特约类型定义
AGREEMENT_TYPES = {
    "团体特约": {
        "priority": ["报价单", "合同"],
        "description": "团体特约条款"
    },
    "个人特约": {
        "priority": ["合同"],
        "description": "个人特约条款"
    },
    "其他特约": {
        "priority": ["报价单", "合同"],
        "description": "其他特约条款"
    }
}