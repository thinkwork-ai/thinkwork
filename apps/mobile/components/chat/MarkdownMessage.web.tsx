import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useColorScheme } from "nativewind";

type MarkdownMessageProps = {
  content: string;
  isUser: boolean;
};

export function MarkdownMessage({ content, isUser }: MarkdownMessageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const textColor = isUser ? (isDark ? "#171717" : "#ffffff") : isDark ? "#d4d4d4" : "#171717";
  const linkColor = isUser ? "#fed7aa" : "#2563eb";
  const codeBg = isUser
    ? "rgba(255,255,255,0.16)"
    : isDark
      ? "rgba(255,255,255,0.14)"
      : "#d4d4d8";
  // Guard: never use pure white backgrounds in dark mode markdown surfaces.
  const blockCodeBg = isUser ? "rgba(255,255,255,0.12)" : isDark ? "rgba(255,255,255,0.08)" : "#f5f5f5";
  const codeTextColor = isUser ? (isDark ? "#171717" : "#ffffff") : isDark ? "#e5e7eb" : "#111827";
  const blockquoteBg = isUser ? "rgba(255,255,255,0.12)" : isDark ? "rgba(255,255,255,0.08)" : "#f3f4f6";
  const blockquoteBorder = isUser ? "rgba(255,255,255,0.32)" : isDark ? "rgba(255,255,255,0.22)" : "#d1d5db";
  const blockquoteText = isUser ? (isDark ? "#171717" : "#ffffff") : isDark ? "#e5e7eb" : "#1f2937";

  return (
    <div style={{ color: textColor, fontSize: 15, lineHeight: 1.35, overflowWrap: "anywhere" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ margin: "2px 0 8px", fontSize: 24, lineHeight: 1.2, fontWeight: 700 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ margin: "2px 0 8px", fontSize: 20, lineHeight: 1.25, fontWeight: 700 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ margin: "2px 0 6px", fontSize: 18, lineHeight: 1.25, fontWeight: 600 }}>{children}</h3>,
          h4: ({ children }) => <h4 style={{ margin: "2px 0 6px", fontSize: 16, lineHeight: 1.25, fontWeight: 600 }}>{children}</h4>,
          p: ({ children }) => <p style={{ margin: "0", fontSize: 16, lineHeight: 1.35 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: "0 0 4px", paddingLeft: 20, listStyleType: "disc" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 4px", paddingLeft: 20, listStyleType: "decimal" }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "4px 0 8px",
                padding: "8px 12px",
                borderLeft: `3px solid ${blockquoteBorder}`,
                borderRadius: 8,
                background: blockquoteBg,
                color: blockquoteText,
              }}
            >
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: linkColor, textDecoration: "underline" }}>
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code
                  className={className}
                  style={{
                    display: "block",
                    background: blockCodeBg,
                    borderRadius: 8,
                    padding: 10,
                    margin: "2px 0 6px",
                    color: codeTextColor,
                    fontFamily: "Menlo, Monaco, Consolas, monospace",
                    fontSize: 13,
                    lineHeight: 1.35,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={className}
                style={{
                  color: codeTextColor,
                  background: codeBg,
                  borderRadius: 6,
                  padding: "1px 5px",
                  fontFamily: "Menlo, Monaco, Consolas, monospace",
                  fontSize: 13,
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
