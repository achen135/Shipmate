import { BellRing, ClipboardList, FileText, Radar } from "lucide-react";

import { Logo } from "@/components/brand/logo";

const FEATURES = [
  {
    icon: Radar,
    title: "Watches every 30 minutes",
    body: "Internship aggregators and company job boards, matched against the searches you save.",
  },
  {
    icon: BellRing,
    title: "Tells you when it matters",
    body: "One notification per check, with priority companies first.",
  },
  {
    icon: FileText,
    title: "Tailors your resume (optional)",
    body: "With your own Anthropic or OpenAI key. It only rewords and reorders what's already true.",
  },
  {
    icon: ClipboardList,
    title: "Tracks every application",
    body: "From saved to offer, with the exact resume you sent.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-6 sm:py-10">
      <header>
        <Logo />
      </header>

      <main className="flex flex-1 flex-col justify-center py-10">
        <h1 className="font-heading text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
          Your crewmate for internship season.
        </h1>
        <p className="mt-4 text-lg text-pretty text-muted-foreground">
          ShipMate finds new postings, gets your application ready, and keeps
          track of where everything stands. It never submits anything for you:
          you review, then apply.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-xl border bg-card p-4">
              <Icon aria-hidden="true" className="size-5 text-brass" />
              <h2 className="mt-2 font-medium">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t pt-4 text-sm text-muted-foreground">
        Invite-only while in development.
      </footer>
    </div>
  );
}
