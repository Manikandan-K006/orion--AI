import { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-accent ${className}`}
      {...props}
    />
  );
}
