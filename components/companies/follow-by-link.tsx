"use client";

import { Link2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { followByCareersLink } from "@/app/(app)/profile/companies/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Paste a company's careers page; Shipmate works out the job board behind it
 * (lib/follows/detect.ts) and starts watching it.
 */
export function FollowByLink() {
  const uid = useId();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await followByCareersLink({ url, name });
      if (result.ok) {
        toast.success(result.message);
        setUrl("");
        setName("");
        setErrors({});
        return;
      }
      setErrors(result.fieldErrors ?? {});
      toast.error(result.message);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field data-invalid={!!errors.url}>
        <FieldLabel htmlFor={`${uid}-url`}>Careers page link</FieldLabel>
        <Input
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://boards.greenhouse.io/stripe"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={!!errors.url}
          aria-describedby={`${uid}-url-help`}
        />
        <FieldDescription id={`${uid}-url-help`}>
          Greenhouse, Lever, Ashby, SmartRecruiters, or Workday.
        </FieldDescription>
        {errors.url && (
          <p role="alert" className="text-sm text-destructive">
            {errors.url[0]}
          </p>
        )}
      </Field>
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor={`${uid}-name`}>Company name (optional)</FieldLabel>
        <Input
          id={`${uid}-name`}
          autoComplete="off"
          placeholder="Taken from the link if you leave it empty"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
        />
        {errors.name && (
          <p role="alert" className="text-sm text-destructive">
            {errors.name[0]}
          </p>
        )}
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        <Link2 aria-hidden="true" />
        {pending ? "Following…" : "Follow"}
      </Button>
    </form>
  );
}
