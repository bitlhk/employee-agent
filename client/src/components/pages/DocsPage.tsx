import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type TocItem = { level: 2 | 3; text: string; id: string; num: string };

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`~!@#$%^&*()+=\[\]{}|\\;:'",.<>/?]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractToc(markdown: string): TocItem[] {
  const lines = markdown.split("\n");
  const out: TocItem[] = [];
  const idCount = new Map<string, number>();
  let h2Count = 0;
  let h3Count = 0;
  let lastH2 = 0;

  for (const line of lines) {
    const m = line.match(/^(##|###)\s+(.+)$/);
    if (!m) continue;
    const level = m[1] === "##" ? 2 : 3;
    const text = m[2].trim();
    let id = slugify(text) || "section";
    const c = idCount.get(id) || 0;
    if (c > 0) id = `${id}-${c}`;
    idCount.set(slugify(text) || "section", c + 1);

    if (level === 2) {
      h2Count++;
      h3Count = 0;
      lastH2 = h2Count;
      out.push({ level, text, id, num: String(h2Count) });
    } else {
      h3Count++;
      out.push({ level, text, id, num: `${lastH2}.${h3Count}` });
    }
  }
  return out;
}

// 从 react-markdown 节点提取纯文本（必须和 extractToc 的 slugify 结果一致）
function nodeToText(node: any): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (node.type === "text" && typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) return node.children.map(nodeToText).join("");
  return "";
}

export function DocsPage() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState("");
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const resp = await fetch("/api/claw/help-doc", { credentials: "include" });
        if (!resp.ok) throw new Error(`加载失败 (${resp.status})`);
        const data = await resp.json();
        if (mounted) setContent(String(data?.content || "暂无文档内容"));
      } catch (e: any) {
        if (mounted) setContent(e?.message || "文档加载失败");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const toc = useMemo(() => extractToc(content), [content]);
  const filteredToc = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return toc;
    return toc.filter((t) => t.text.toLowerCase().includes(k));
  }, [toc, q]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    } else {
      console.warn("[DocsPage] jumpTo: element not found by id:", id);
    }
  };

  useEffect(() => {
    if (!toc.length) return;
    const els = toc.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const onScroll = () => {
      const top = (mainRef.current?.getBoundingClientRect().top || 0) + 24;
      let current = toc[0]?.id || "";
      for (const el of els) {
        if (el.getBoundingClientRect().top - top <= 0) current = el.id;
        else break;
      }
      setActiveId(current);
    };
    onScroll();
    const node = mainRef.current;
    node?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      node?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [toc, content]);

  return (
    <div className="h-full min-h-0 flex" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <aside className="w-72 shrink-0 border-r px-4 py-4 hidden md:block" style={{ borderColor: "var(--oc-border)", background: "var(--oc-panel)" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--oc-text-primary)" }}>文档目录</p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索章节..."
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
        />
        <div className="mt-3 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto stealth-scrollbar">
          {filteredToc.length === 0 && <p className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>没有匹配章节</p>}
          {filteredToc.map((item) => (
            <button
              key={item.id}
              onClick={() => jumpTo(item.id)}
              className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-white/10 transition-colors"
              style={{
                color: activeId === item.id ? "var(--oc-accent)" : "var(--oc-text-primary)",
                paddingLeft: item.level === 3 ? 24 : 8,
                background: activeId === item.id ? "color-mix(in oklab, var(--oc-accent) 12%, transparent)" : "transparent",
                border: activeId === item.id ? "1px solid color-mix(in oklab, var(--oc-accent) 25%, transparent)" : "1px solid transparent"
              }}
            >
              <span style={{ color: activeId === item.id ? "var(--oc-accent)" : "var(--oc-text-secondary)", marginRight: 6, fontVariantNumeric: "tabular-nums", fontSize: "var(--oc-text-sm)" }}>
                {item.num}
              </span>
              {item.text}
            </button>
          ))}
        </div>
      </aside>

      <main ref={mainRef} className="flex-1 min-w-0 px-6 py-5 overflow-y-auto stealth-scrollbar">
        <div className="max-w-4xl mx-auto rounded-xl px-5 py-4" style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)" }}>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--oc-text-secondary)" }}>文档加载中…</p>
          ) : (
            <div className="lingxia-markdown docs-markdown-white">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  h2({ children, node }: any) {
                    const rawText = nodeToText(children);
                    const txt = rawText.trim() || "section";
                    const id = slugify(txt);
                    return <h2 id={id} style={{ color: "var(--oc-text-primary)", scrollMarginTop: 20 }}>{children}</h2>;
                  },
                  h3({ children, node }: any) {
                    const rawText = nodeToText(children);
                    const txt = rawText.trim() || "section";
                    const id = slugify(txt);
                    return <h3 id={id} style={{ color: "var(--oc-text-primary)", scrollMarginTop: 20 }}>{children}</h3>;
                  },
                  p({ children }: any) {
                    return <p style={{ color: "var(--oc-text-primary)" }}>{children}</p>;
                  },
                  li({ children }: any) {
                    return <li style={{ color: "var(--oc-text-primary)" }}>{children}</li>;
                  },
                }}
              >
                {content || "暂无文档内容"}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
