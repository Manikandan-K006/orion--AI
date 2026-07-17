import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  const variants = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    ghost: "bg-transparent text-heading border-transparent hover:surface-2",
  };
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border border-transparent px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
