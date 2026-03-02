"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toasts. Follows the OS color scheme, same as the theme tokens in
 * globals.css (no next-themes), and draws from those tokens.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
