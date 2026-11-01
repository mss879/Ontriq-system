import Link from "@/components/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-5 overflow-hidden p-6 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-60" />
      <LogoMark className="relative h-12" />
      <p className="relative font-display text-7xl leading-none font-semibold tracking-tight text-brand-gradient">404</p>
      <div className="relative space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="max-w-sm text-sm text-muted-foreground">It may have moved, or you may not have access to it.</p>
      </div>
      <Button asChild variant="outline" size="lg" className="relative h-10 px-5">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
