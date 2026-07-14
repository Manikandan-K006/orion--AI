import { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-32 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent ${className}`}
      {...props}
    />
  );
}
