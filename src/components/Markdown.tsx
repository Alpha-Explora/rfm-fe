'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Shared markdown renderer for agent output. react-markdown builds a safe React
// tree (no raw HTML injection); remark-gfm adds tables, task lists, and
// strikethrough that the LLM agents commonly emit. Links open in a new tab.
export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node, ...props }) {
            void node;
            return <a {...props} target="_blank" rel="noreferrer noopener" />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
