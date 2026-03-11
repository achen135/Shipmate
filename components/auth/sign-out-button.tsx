import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  variant = "outline",
}: {
  variant?: "outline" | "link";
}) {
  return (
    <form action={signOut} className="contents">
      <Button
        type="submit"
        variant={variant}
        className={variant === "link" ? "h-auto p-0" : undefined}
      >
        Sign out
      </Button>
    </form>
  );
}
