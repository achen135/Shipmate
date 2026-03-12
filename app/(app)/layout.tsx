import Link from "next/link";

import { BottomNav } from "@/components/app/bottom-nav";
import { LogoMark } from "@/components/brand/logo";

/**
 * Shell for the four main tabs. Static, so it prerenders; each page checks
 * the session itself (lib/auth/viewer.ts) because layouts don't re-render on
 * navigation.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col pb-20">
      <header className="mx-auto flex w-full max-w-2xl items-center px-5 pt-4">
        <Link href="/inbox" aria-label="ShipMate">
          <LogoMark className="size-7" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
