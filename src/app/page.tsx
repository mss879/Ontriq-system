import Link from "@/components/link";
import { LogoLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/** The proxy normally redirects "/" to the right area; this is the fallback. */
export default function Home() {
  return (
    <main className="brand-glow relative flex min-h-svh flex-col items-center justify-center gap-8 overflow-hidden p-6 text-center text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-[0.06]" />
      <LogoLockup reversed className="relative h-16 text-white" />
      <div className="relative space-y-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Background verification, managed end to end.</h1>
        <p className="mx-auto max-w-sm text-sm text-white/70">Sign in to manage verifications or follow your requests.</p>
      </div>
      <Button asChild variant="brand" size="lg" className="relative h-11 px-7">
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
