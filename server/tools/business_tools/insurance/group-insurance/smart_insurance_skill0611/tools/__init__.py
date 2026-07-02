"""
Tools module initialization

MCP工具定义模块
"""

from smart_insurance_skill0611.tools.vision_tool import VisionTool
from smart_insurance_skill0611.tools.llm_tool import LLMTool
from smart_insurance_skill0611.tools.extraction_tool import ExtractionTool
from smart_insurance_skill0611.tools.document_tool import DocumentTool

__all__ = [
    'VisionTool',
    'LLMTool',
    'ExtractionTool',
    'DocumentTool'
]