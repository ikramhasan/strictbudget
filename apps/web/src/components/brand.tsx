import { cn } from "@strictbudget/ui/lib/utils";
import { useId } from "react";

/** The app icon (as in favicon.svg). */
export function BrandMark({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a86f3" />
          <stop offset="1" stopColor="#2c4fc2" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
      <g fill="none" stroke="#fff">
        <path d="M44.50 18.36A18.5 18.5 0 0 1 28.95 50.25" strokeWidth="6.5" />
        <path d="M24.33 48.83A18.5 18.5 0 0 1 15.59 23.46" strokeWidth="6.5" />
        <path d="M18.36 19.50A18.5 18.5 0 0 1 40.54 15.59" strokeWidth="6.5" />
        <path d="M37.6 26.4A7.6 7.6 0 1 0 37.6 37.6" strokeWidth="4.4" strokeLinecap="round" />
        <path d="M31.9 21V43" strokeWidth="3.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** The icon and the name, as on the marketing site. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-9" />
      <span className="text-xl tracking-tight">
        <span className="font-bold">strict</span>
        <span className="font-normal">budget</span>
      </span>
    </span>
  );
}
