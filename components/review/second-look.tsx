import type { Suggestion } from "@/lib/tailor/second-look";

/**
 * "A second look" (M8 §0.5): what a second read of the tailored copy
 * noticed. Kept apart from "What changed" (what Shipmate did): none of these
 * were applied.
 */
export function SecondLook({ suggestions }: { suggestions: Suggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="second-look">
      <h3 className="font-medium">A second look</h3>
      <p className="text-sm text-muted-foreground">
        A second read of the finished copy noticed these. Shipmate didn&apos;t
        change anything here: if one is worth taking, use Edit this copy above.
      </p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {suggestions.map((s, i) => (
          <li key={i}>{s.what}</li>
        ))}
      </ul>
    </div>
  );
}
