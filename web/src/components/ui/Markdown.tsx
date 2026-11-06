import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Safe Markdown rendering: raw HTML is not rendered (react-markdown default), links open safely. */
export function Markdown({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => {
            const safe = href && /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined;
            const external = safe?.startsWith('http');
            return <a href={safe} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{c}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
