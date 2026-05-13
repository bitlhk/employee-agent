import { useState, memo } from "react";
import { Copy, Check, Play, FileCode2 } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  fileName?: string;
  onRun?: (code: string) => void;
  showLineNumbers?: boolean;
}

function CodeBlockInner({ code, language = "text", fileName, onRun, showLineNumbers = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const lines = code.split("\n");
  const lineNumberWidth = String(lines.length).length;

  return (
    <div className="ca-codeblock">
      {/* Header: 文件名 + 语言 + 操作按钮 */}
      <div className="ca-codeblock-header">
        <div className="ca-codeblock-header-left">
          <FileCode2 size={12} />
          <span className="ca-codeblock-filename">{fileName || language}</span>
        </div>
        <div className="ca-codeblock-header-actions">
          {onRun && (
            <button onClick={() => onRun(code)} className="ca-codeblock-btn ca-codeblock-btn-run" title="运行">
              <Play size={11} /> 运行
            </button>
          )}
          <button onClick={handleCopy} className="ca-codeblock-btn" title="复制">
            {copied ? <><Check size={11} /> 已复制</> : <><Copy size={11} /> 复制</>}
          </button>
        </div>
      </div>
      {/* Code body with line numbers */}
      <div className="ca-codeblock-body">
        <pre className="ca-codeblock-pre">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="ca-codeblock-line">
                {showLineNumbers && (
                  <span className="ca-codeblock-linenum" style={{ width: `${lineNumberWidth + 1}ch` }}>
                    {i + 1}
                  </span>
                )}
                <span className="ca-codeblock-linecontent">{line || " "}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

export const CodeBlock = memo(CodeBlockInner);
