import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link
          href="/profile"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to app
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-6 py-8">{children}</main>
    </div>
  );
}
