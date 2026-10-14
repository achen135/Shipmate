"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ResumeContent } from "@/lib/resume/structured";
import { renderResumeHtml } from "@/lib/resume/template";

/** Letter paper at 96 dpi. */
const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

/**
 * The resume exactly as the template prints it, in a sandboxed iframe (no
 * scripts, its own styles), scaled down to fit the column.
 */
export function ResumePreview({ content }: { content: ResumeContent }) {
  const html = useMemo(() => renderResumeHtml(content), [content]);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / PAGE_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      className="w-full overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{ height: PAGE_HEIGHT * scale }}
    >
      <iframe
        title="Resume preview"
        sandbox=""
        srcDoc={html}
        style={{
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
        }}
      />
    </div>
  );
}
