import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('java', java);

const LANG: Record<string, string> = {
  TypeScript: 'typescript', JavaScript: 'javascript', JSON: 'json', CSS: 'css', SCSS: 'css', Less: 'css', HTML: 'xml', XML: 'xml', Vue: 'xml', Svelte: 'xml',
  Python: 'python', Go: 'go', Rust: 'rust', Shell: 'bash', YAML: 'yaml', Markdown: 'markdown', SQL: 'sql', Java: 'java', Kotlin: 'java',
};

/** Read-only, highlighted code view with line numbers. Escaping is done by highlight.js. Not an editor (§3.4). */
export function CodeViewer({ text, language }: { text: string; language: string | null }) {
  const lines = useMemo(() => {
    const lang = language ? LANG[language] : undefined;
    let html: string;
    try {
      html = lang ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(text.slice(0, 50_000)).value;
    } catch {
      html = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    }
    // keep spans balanced per line
    const out: string[] = [];
    let open: string[] = [];
    for (const raw of html.split('\n')) {
      const prefix = open.join('');
      const tags = raw.match(/<span[^>]*>|<\/span>/g) ?? [];
      for (const t of tags) { if (t === '</span>') open.pop(); else open.push(t); }
      out.push(prefix + raw + '</span>'.repeat(open.length));
    }
    open = [];
    return out;
  }, [text, language]);
  return (
    <div className="code-view" role="region" aria-label="Quelltext (nur lesend)">
      <table>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="ln">{i + 1}</td>
              {/* eslint-disable-next-line react/no-danger */}
              <td className="lc" dangerouslySetInnerHTML={{ __html: l || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
