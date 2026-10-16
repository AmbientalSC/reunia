"use client";

import { memo, useMemo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';
import { normalizeWebUrl, webHost } from '@/lib/safe-url';

/** Opens a web link in the system browser; anything else is never made clickable. */
export function openWebLink(url: string): void {
  const safeUrl = normalizeWebUrl(url);
  if (!safeUrl) return;

  invoke('open_external_url', { url: safeUrl }).catch((error) => {
    console.error('Failed to open link:', error);
  });
}

// The typography plugin is not active in this project, so the elements are styled one by one.
const BASE_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[#164194]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-1 font-semibold text-[#164194]">{children}</p>,
  h2: ({ children }) => <p className="mb-1 font-semibold text-[#164194]">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-semibold text-[#164194]">{children}</p>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-4 border-[#A8C950] pl-3 text-gray-600">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left">{children}</th>
  ),
  td: ({ children }) => <td className="border border-gray-200 px-2 py-1">{children}</td>,
  // Remote images are blocked by the CSP anyway; never render them.
  img: () => null,
};

/**
 * Links in the model's text are only clickable when they are one of the sources the
 * provider reported (`allowedUrls`). Any other link a model writes could have been
 * planted by a web page or by someone talking in the meeting, so it stays plain text
 * with its real host shown next to it.
 */
function buildComponents(allowedUrls: ReadonlySet<string>): Components {
  return {
    ...BASE_COMPONENTS,
    a: ({ href, children }) => {
      const safeUrl = normalizeWebUrl(href);
      const host = webHost(href);

      if (safeUrl && allowedUrls.has(safeUrl)) {
        return (
          <a
            href={safeUrl}
            title={safeUrl}
            className="text-[#164194] underline underline-offset-2 hover:text-[#0f2f6e]"
            onClick={(event) => {
              event.preventDefault();
              openWebLink(safeUrl);
            }}
          >
            {children}
            {host && <span className="text-gray-500 no-underline"> ({host})</span>}
          </a>
        );
      }

      return (
        <span>
          {children}
          {host && <span className="text-gray-500"> ({host})</span>}
        </span>
      );
    },
  };
}

interface AskMarkdownProps {
  children: string;
  /** URLs of the sources reported by the provider; only these links are clickable. */
  allowedUrls?: string[];
}

/** Renders an AI answer. Raw HTML in the text is dropped, only Markdown is honored. */
export const AskMarkdown = memo(function AskMarkdown({ children, allowedUrls = [] }: AskMarkdownProps) {
  const allowedKey = allowedUrls.join('\n');
  const components = useMemo(
    () =>
      buildComponents(
        new Set(
          allowedKey
            .split('\n')
            .map((url) => normalizeWebUrl(url))
            .filter((url): url is string => url !== null)
        )
      ),
    [allowedKey]
  );

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {children}
    </ReactMarkdown>
  );
});
