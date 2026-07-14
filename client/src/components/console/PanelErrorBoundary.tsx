import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  title?: string;
  description?: string;
  resetKey?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="panel-error-boundary">
        <div className="panel-error-boundary__card">
          <div className="panel-error-boundary__icon">
            <AlertTriangle size={18} />
          </div>
          <div className="panel-error-boundary__body">
            <h2>{this.props.title || "当前页面暂时不可用"}</h2>
            <p>{this.props.description || "组件渲染时出现异常，其他工作台区域不受影响。可以重试当前页面，或切换到其他功能。"}</p>
            <details className="panel-error-boundary__details">
              <summary>错误详情</summary>
              <pre>{this.state.error?.stack || this.state.error?.message || "unknown error"}</pre>
            </details>
            <button
              type="button"
              className="panel-error-boundary__action"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RotateCcw size={14} />
              重试当前页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
