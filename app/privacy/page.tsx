import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Shipmate stores, who can see it, and how to delete it.",
};

/**
 * Public privacy page. Plain English, kept in step with what the app actually
 * stores (Spec "Data model"). Google requires it before the OAuth app leaves
 * Testing.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-6 sm:py-10">
      <header>
        <Link href="/" aria-label="Shipmate home">
          <Logo />
        </Link>
      </header>

      <main className="flex flex-col gap-8 py-10 text-pretty">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Privacy
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Shipmate is a small app Alex Chen runs for a group of friends. This
            page says what it keeps about you and who can see it.
          </p>
        </div>

        <Section title="What Shipmate stores">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Your account:</strong> your email address, and your name
              if you sign in with Google.
            </li>
            <li>
              <strong>What you tell it:</strong> school, degree, graduation
              date, work authorization, sponsorship need, the searches you save,
              and what you do with each posting (saved, skipped, applied,
              notes).
            </li>
            <li>
              <strong>Later features, only if you use them:</strong> your
              resume, extra facts for tailoring, an AI provider key, and
              notification settings.
            </li>
            <li>
              <strong>Job postings</strong> come from public sources and are
              shared by everyone. They aren&apos;t about you.
            </li>
          </ul>
          <p>
            The only cookies are the ones that keep you signed in. There are no
            ads, no analytics trackers, and nothing is sold or shared for
            marketing.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            Other users can&apos;t see anything of yours. The database enforces
            that with row-level security: each person&apos;s rows can only be
            read with their own sign-in.
          </p>
          <p>
            <strong>One caveat:</strong> Alex, who runs Shipmate, can see all
            data in the database dashboard, and only looks when something needs
            fixing.
          </p>
        </Section>

        <Section title="AI">
          <p>
            In AI mode, Shipmate sends your resume, your extra facts and the
            posting&apos;s text to an AI provider to read and tailor your
            resume. Nothing else: not your answers, your tracker or your notes.
          </p>
          <p>
            Unless you add your own key, that provider is Google Gemini, on a
            shared key Alex provides on Google&apos;s free tier. Google says it
            may use what&apos;s sent on its free tier to improve its products.
            If you&apos;d rather it didn&apos;t, add your own paid key or use
            Simple mode, which sends nothing to any AI.
          </p>
          <p>
            If you add your own Anthropic, OpenAI or Google key, it is encrypted
            before it is saved (AES-256-GCM). The app never shows it again; you
            only see its last four characters. Alex holds the master key that
            encrypts it. Tailoring then runs under your key and that
            provider&apos;s terms.
          </p>
        </Section>

        <Section title="Where it lives">
          <p>
            Data is stored with Supabase (database and sign-in). The app is
            hosted on Vercel, and the job watcher runs on GitHub Actions. Google
            handles &ldquo;Continue with Google&rdquo; and only shares your name
            and email.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Ask Alex (the person who invited you) to delete your account.
            Everything tied to it (profile, searches, tracker, and anything you
            uploaded) is removed with it, within a week of asking.
          </p>
        </Section>
      </main>

      <footer className="border-t pt-4 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          Back to Shipmate
        </Link>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}
