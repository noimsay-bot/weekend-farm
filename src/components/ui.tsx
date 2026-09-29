import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </main>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const style =
    variant === "primary"
      ? "bg-primary text-white disabled:opacity-50"
      : "border border-primary text-primary bg-white disabled:opacity-50";
  return (
    <button
      className={`h-12 w-full rounded-lg px-4 text-base font-semibold ${style} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base"
        {...props}
      />
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600">{children}</p>;
}
