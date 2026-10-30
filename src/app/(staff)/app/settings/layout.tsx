import { Suspense } from "react";
import { getStaffViewer } from "@/lib/server/viewer";
import { SETTINGS_NAV, canSeeNavItem } from "@/components/layout/nav";
import { SettingsTabs } from "./settings-tabs";

/** Settings areas as tabs; each tab shows only with its permission. */
export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return (
    <>
      <div className="border-b bg-background/60">
        <Suspense fallback={<div className="h-12" />}>
          <Tabs />
        </Suspense>
      </div>
      {children}
    </>
  );
}

async function Tabs() {
  const viewer = await getStaffViewer();
  const items = SETTINGS_NAV.filter((item) => canSeeNavItem(item, viewer)).map(({ title, href }) => ({ title, href }));
  return <SettingsTabs items={items} />;
}
