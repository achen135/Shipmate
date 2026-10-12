import Link from "next/link";

const ADMIN_LINKS = [
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/sources", label: "Sources" },
] as const;

/**
 * Rendered by each admin page after requireAdmin(), not by the layout: the
 * layout also wraps the not-found page non-admins get, which shouldn't list
 * admin pages.
 */
export function AdminNav() {
  return (
    <nav aria-label="Admin" className="flex gap-4 text-sm">
      {ADMIN_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
