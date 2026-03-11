export function PageHeader({ title }: { title: string }) {
  return (
    <h1 className="font-heading text-2xl font-semibold tracking-tight">
      {title}
    </h1>
  );
}
