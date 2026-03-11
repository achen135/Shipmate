export function StepHeader({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">Step {step}</p>
      <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight">
        {title}
      </h1>
      {children && <p className="mt-2 text-muted-foreground">{children}</p>}
    </div>
  );
}
