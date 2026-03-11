export default function Loading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
