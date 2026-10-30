import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const TONES = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4"];

export function personTone(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function personInitials(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function PersonAvatar({ id, name, size = "md", className }: { id: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = size === "sm" ? "size-6 rounded-lg text-[10px]" : size === "lg" ? "size-10 rounded-xl text-sm" : "size-8 rounded-lg text-xs";
  return (
    <Avatar className={cn(dims, className)}>
      <AvatarFallback className={cn(dims, "font-semibold text-white", personTone(id))}>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Avatar and name; "Unassigned" when nobody holds it. */
export function PersonChip({ person, className, empty = "Unassigned" }: { person: { id: string; name: string } | null; className?: string; empty?: string }) {
  if (!person) return <span className={cn("text-sm text-muted-foreground", className)}>{empty}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <PersonAvatar id={person.id} name={person.name} size="sm" />
      <span className="truncate text-sm">{person.name}</span>
    </span>
  );
}
