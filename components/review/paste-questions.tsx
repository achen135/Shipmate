"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { savePastedQuestions } from "@/app/(app)/postings/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX = 20000;

/**
 * For applications Shipmate can't read (Workday and other login-gated ATSs):
 * paste the questions so they live with this posting. M5 only stores and shows
 * them; M7 turns them into essay ideas.
 */
export function PasteQuestions({
  userPostingId,
  saved,
}: {
  userPostingId: string;
  saved: string;
}) {
  const [text, setText] = useState(saved);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await savePastedQuestions(userPostingId, text);
      if (result.ok) toast.success(text.trim() ? "Saved." : "Cleared.");
      else toast.error(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="pasted-questions" className="text-sm font-medium">
        Paste the questions
      </label>
      <Textarea
        id="pasted-questions"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={MAX}
        rows={6}
        placeholder="Open the application, copy its questions, and paste them here to keep them with this posting."
      />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pending || text === saved}
        onClick={save}
      >
        {pending ? "Saving…" : "Save questions"}
      </Button>
    </div>
  );
}
