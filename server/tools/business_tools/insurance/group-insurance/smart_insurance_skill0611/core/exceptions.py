"""
Smart Insurance Skill 0611 - 异常定义

定义所有自定义异常类，支持MCP相关的异常处理
"""


class SkillError(Exception):
    """Skill基础异常"""
    def __init__(self, message: str, details: dict = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def __str__(self):
        if self.details:
            return f"{self.message} - Details: {self.details}"
        return self.message


class MCPConnectionError(SkillError):
    """MCP连接异常"""
    def __init__(self, message: str, server_url: str = None):
        details = {'server_url': server_url} if server_url else {}
        super().__init__(message, details)


class MCPToolError(SkillError):
    """MCP工具调用异常"""
    def __init__(self, message: str, tool_name: str = None, tool_args: dict = None):
        details = {
            'tool_name': tool_name,
            'tool_args': tool_args
        } if tool_name else {}
        super().__init__(message, details)


class MCPResponseError(SkillError):
    """MCP响应解析异常"""
    def __init__(self, message: str, response_data: dict = None):
        details = {'response_data': response_data} if response_data else {}
        super().__init__(message, details)


class PipelineError(SkillError):
    """Pipeline执行异常"""
    def __init__(self, message: str, step_name: str = None):
        details = {'step_name': step_name} if step_name else {}
        super().__init__(message, details)


class ExtractionError(SkillError):
    """数据提取异常"""
    def __init__(self, message: str, field_name: str = None, source: str = None):
        details = {
            'field_name': field_name,
            'source': source
        } if field_name else {}
        super().__init__(message, details)


class ValidationError(SkillError):
    """数据验证异常"""
    def __init__(self, message: str, field_name: str = None, expected_type: str = None):
        details = {
            'field_name': field_name,
            'expected_type': expected_type
        } if field_name else {}
        super().__init__(message, details)


class TemplateError(SkillError):
    """模板相关异常"""
    def __init__(self, message: str, template_name: str = None):
        details = {'template_name': template_name} if template_name else {}
        super().__init__(message, details)


class ConfigurationError(SkillError):
    """配置相关异常"""
    def __init__(self, message: str, config_key: str = None):
        details = {'config_key': config_key} if config_key else {}
        super().__init__(message, details)