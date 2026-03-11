import { Logo } from "@/components/brand/logo";

export default function OnboardingLayout({
  children,
}: LayoutProps<"/onboarding">) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <header>
        <Logo />
      </header>
      <main className="flex flex-1 flex-col gap-6 py-8">{children}</main>
    </div>
  );
}
