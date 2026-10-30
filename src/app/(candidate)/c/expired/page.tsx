import { Suspense } from "react";
import { asCandidateLang } from "@/domain/candidate/i18n";
import { asExpiredReason, ExpiredView } from "@/components/candidate/expired-view";

export default function CandidateExpiredPage({ searchParams }: PageProps<"/c/expired">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <Expired searchParams={searchParams} />
    </Suspense>
  );
}

async function Expired({ searchParams }: { searchParams: PageProps<"/c/expired">["searchParams"] }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const reason = asExpiredReason(one(sp.reason));
  const lang = asCandidateLang(one(sp.lang)) ?? "en";
  return <ExpiredView lang={lang} reason={reason} hrefFor={(l) => `/c/expired?reason=${reason}&lang=${l}`} />;
}
