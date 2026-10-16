"use client";

import { RefObject, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { computeButtonPosition, normalizeSelection } from '@/lib/ask-selection';

interface SelectionState {
  text: string;
  left: number;
  top: number;
}

interface SelectionAskButtonProps {
  /** Only selections made inside this element show the button. */
  scopeRef: RefObject<HTMLElement>;
  onAsk: (selectedText: string) => void;
}

/**
 * Floating "Perguntar à IA" button shown next to text selected inside `scopeRef`.
 *
 * It appears when the user finishes selecting (mouse up / keyboard) rather than
 * while dragging, and disappears as soon as the selection goes away or the page
 * scrolls. Rendered `fixed` above the recording controls.
 */
export function SelectionAskButton({ scopeRef, onAsk }: SelectionAskButtonProps) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  useEffect(() => {
    const read = () => {
      const current = window.getSelection();
      const scope = scopeRef.current;
      if (!current || current.isCollapsed || current.rangeCount === 0 || !scope) {
        setSelection(null);
        return;
      }

      const range = current.getRangeAt(0);
      const text = normalizeSelection(current.toString());
      if (!text || !scope.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }

      const position = computeButtonPosition(range.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setSelection({ text, ...position });
    };

    // Wait a frame: the selection is only final after the mouse/keyboard event settles.
    let pendingFrame = 0;
    const readSoon = () => {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = window.requestAnimationFrame(read);
    };
    const hide = () => setSelection(null);
    // The answer panel scrolls by itself when a reply arrives; that must not hide the button.
    const hideOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('aside[aria-label="Perguntar à IA"]')) return;
      hide();
    };
    const hideIfCollapsed = () => {
      if (window.getSelection()?.isCollapsed) hide();
    };

    document.addEventListener('mouseup', readSoon);
    document.addEventListener('keyup', readSoon);
    document.addEventListener('selectionchange', hideIfCollapsed);
    window.addEventListener('scroll', hideOnScroll, true);
    window.addEventListener('resize', hide);

    return () => {
      window.cancelAnimationFrame(pendingFrame);
      document.removeEventListener('mouseup', readSoon);
      document.removeEventListener('keyup', readSoon);
      document.removeEventListener('selectionchange', hideIfCollapsed);
      window.removeEventListener('scroll', hideOnScroll, true);
      window.removeEventListener('resize', hide);
    };
  }, [scopeRef]);

  if (!selection) return null;

  return (
    <button
      type="button"
      style={{ left: selection.left, top: selection.top }}
      className="fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#164194] px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-[#0f2f6e]"
      // Keep the text selected: a normal mousedown would collapse it before the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onAsk(selection.text);
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      }}
    >
      <Sparkles size={13} aria-hidden="true" />
      Perguntar à IA
    </button>
  );
}
