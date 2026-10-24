import { cn } from "@strictbudget/ui/lib/utils";

// Eight spokes, each a step brighter clockwise. The whole mark turns in
// eight steps, so the bright spoke ticks forward and the rest trail it.
const spokes = Array.from({ length: 8 }, (_, index) => index);

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={cn(
        "size-4 animate-[spin_0.8s_steps(8,end)_infinite] motion-reduce:animate-[spin_1.6s_steps(8,end)_infinite]",
        className,
      )}
      {...props}
    >
      {spokes.map((index) => (
        <line
          key={index}
          x1="12"
          y1="2.5"
          x2="12"
          y2="6.5"
          opacity={(index + 1) / spokes.length}
          transform={`rotate(${index * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

export { Spinner };
