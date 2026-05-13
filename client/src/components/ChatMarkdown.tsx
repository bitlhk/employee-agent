import { memo, useState, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function childrenToString(children: any): string {
  if (children == null) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join("");
  if (isValidElement(children)) {
    const el = children as any;
    return childrenToString(el.props?.children ?? "");
  }
  return String(children);
}

function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[^\w\u4e00-\u9fa5 -]/g, "")
    .replace(/\s+/g, "-");
}

function extractLang(className?: string): string {
  if (!className) return "";
  const m = className.match(/language-(\w+)/);
  return m ? m[1] : "";
}

function FencedCodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const lang = extractLang(className) || "text";
  const isHtml = lang === "html" || lang === "htm";

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const onOpenNewTab = () => {
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(code); w.document.close(); }
  };

  return (
    <div className="lingxia-codeblock">
      <div className="lingxia-codeblock__header">
        <span className="lingxia-codeblock__lang">{lang}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {isHtml && (
            <>
              <button className="lingxia-codeblock__copy" onClick={() => setPreviewing(!previewing)} type="button" title={previewing ? "关闭预览" : "预览"}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                {previewing ? "关闭" : "预览"}
              </button>
              <button className="lingxia-codeblock__copy" onClick={onOpenNewTab} type="button" title="新窗口打开">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                新窗口
              </button>
            </>
          )}
          <button className="lingxia-codeblock__copy" onClick={onCopy} type="button">
            {copied ? (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
            ) : (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
            )}
          </button>
        </div>
      </div>
      {previewing && isHtml && (
        <div style={{ background: "#fff", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          <iframe
            srcDoc={code}
            sandbox="allow-scripts allow-modals"
            style={{ width: "100%", height: 480, border: "none", display: "block" }}
            title="HTML Preview"
          />
        </div>
      )}
      {!previewing && <pre className="lingxia-codeblock__body"><code className={className}>{code}</code></pre>}
    </div>
  );
}

type Props = { content: string };

function ChatMarkdownInner({ content }: Props) {
  return (
    <div className="lingxia-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return <code className="lingxia-inline-code" {...props}>{children}</code>;
            }
            const text = childrenToString(children).replace(/\n$/, "");
            // text/plain/无语言标记 → 内联高亮，不换行，不单独成块
            const lang = String(className || "").replace("language-", "").toLowerCase();
            if (!lang || lang === "text" || lang === "plain" || lang === "txt") {
              return <code className="lingxia-inline-code" style={{ whiteSpace: "pre-wrap", color: "inherit" }} {...props}>{children}</code>;
            }
            return <FencedCodeBlock code={text} className={className} />;
          },
          h1: ({ children }) => <h1 className="lingxia-md-h1">{children}</h1>,
          h2: ({ children }) => {
            const text = childrenToString(children);
            const id = slugify(text);
            return (
              <h2 id={id} className="lingxia-md-h2 group">
                <a href={`#${id}`} className="mr-1 opacity-0 group-hover:opacity-100 transition-opacity no-underline"
                  style={{ color: "rgba(255,255,255,0.28)", textDecoration: "none" }} aria-label={`跳转到 ${text}`}>#</a>
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const text = childrenToString(children);
            const id = slugify(text);
            return (
              <h3 id={id} className="lingxia-md-h3 group">
                <a href={`#${id}`} className="mr-1 opacity-0 group-hover:opacity-100 transition-opacity no-underline"
                  style={{ color: "rgba(255,255,255,0.24)", textDecoration: "none" }} aria-label={`跳转到 ${text}`}>#</a>
                {children}
              </h3>
            );
          },
          h4: ({ children }) => <h4 className="lingxia-md-h4">{children}</h4>,
          p:  ({ children }) => <p className="lingxia-md-p">{children}</p>,
          ul: ({ children }) => <ul className="lingxia-md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="lingxia-md-ol">{children}</ol>,
          li: ({ children }) => <li className="lingxia-md-li">{children}</li>,
          blockquote: ({ children }) => <blockquote className="lingxia-md-blockquote">{children}</blockquote>,
          table: ({ children }) => (
            <div className="lingxia-md-table-wrap"><table className="lingxia-md-table">{children}</table></div>
          ),
          th: ({ children }) => <th className="lingxia-md-th">{children}</th>,
          td: ({ children }) => <td className="lingxia-md-td">{children}</td>,
          a:  ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="lingxia-md-link">{children}</a>
          ),
          hr:     () => <hr className="lingxia-md-hr" />,
          strong: ({ children }) => <strong className="lingxia-md-strong">{children}</strong>,
          em:     ({ children }) => <em className="lingxia-md-em">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner, (prev, next) => prev.content === next.content);
