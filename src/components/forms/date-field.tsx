import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The browser's date input, styled like the other fields. It keeps the native
 * calendar and phone pickers; a click anywhere on the field opens the picker.
 */
export function DateField({ className, wrapperClassName, ...props }: Omit<React.ComponentProps<typeof Input>, "type"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <CalendarDays aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 z-[1] size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="date"
        className={cn(
          "relative pl-8 tabular-nums [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          className,
        )}
        {...props}
      />
    </span>
  );
}
