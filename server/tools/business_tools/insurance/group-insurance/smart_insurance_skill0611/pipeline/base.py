"""
Smart Insurance Skill 0611 - Pipeline基类

定义Pipeline的基础结构和接口
移植自原项目的pipeline/base.py
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PipelineStep:
    """Pipeline步骤定义"""
    name: str
    description: str
    timeout: int = 60
    function: Optional[callable] = None
    retries: int = 3


@dataclass
class PipelineContext:
    """Pipeline上下文"""
    task_id: str = ""
    status: str = "initialized"
    inputs: Dict[str, Any] = field(default_factory=dict)
    outputs: Dict[str, Any] = field(default_factory=dict)
    step_results: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    start_time: float = 0.0
    end_time: float = 0.0
    progress: float = 0.0


class BasePipeline(ABC):
    """
    Pipeline基类

    所有Pipeline实现都继承此类

    使用示例:
        class MyPipeline(BasePipeline):
            def run(self, inputs):
                # 实现具体逻辑
                return result
    """

    def __init__(self, config: Dict[str, Any], name: str = "Pipeline"):
        """
        初始化Pipeline

        Args:
            config: 配置字典
            name: Pipeline名称
        """
        self.config = config
        self.name = name
        self.steps: List[PipelineStep] = []
        self._context: Optional[PipelineContext] = None
        self._progress_callback: Optional[callable] = None

    def _init_context(self, inputs: Dict[str, Any]) -> None:
        """初始化上下文"""
        self._context = PipelineContext(
            task_id=inputs.get('task_id', ''),
            inputs=inputs,
            start_time=time.time()
        )

    def _finalize_context(self) -> None:
        """结束上下文"""
        if self._context:
            self._context.end_time = time.time()
            self._context.status = 'completed'

    def _update_progress(self, progress: float, step_name: str = "") -> None:
        """更新进度"""
        if self._context:
            self._context.progress = progress

        if self._progress_callback:
            self._progress_callback(progress, step_name, self._context.task_id)

        logger.info(f"进度更新: {progress}% - {step_name}")

    def set_progress_callback(self, callback: callable) -> None:
        """
        设置进度回调函数

        Args:
            callback: 回调函数 (progress, step_name, task_id)
        """
        self._progress_callback = callback

    @abstractmethod
    def run(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行Pipeline

        Args:
            inputs: 输入数据

        Returns:
            输出结果
        """
        pass

    def get_context(self) -> Optional[PipelineContext]:
        """获取当前上下文"""
        return self._context

    def get_elapsed_time(self) -> float:
        """获取执行耗时"""
        if self._context:
            return self._context.end_time - self._context.start_time
        return 0.0

    def __repr__(self) -> str:
        return f"{self.name}(steps={len(self.steps)})"