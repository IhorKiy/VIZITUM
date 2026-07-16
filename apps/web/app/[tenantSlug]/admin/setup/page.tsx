import { redirect } from "next/navigation";

// The setup ("Zapusk") screen was split between the admin imports page
// (CSV onboarding) and the Pilot section (readiness checklist). This route
// stays only to keep old bookmarks and links working. Unlike /admin/imports
// it forwards no query string — setup never carried one.
type SetupRedirectPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function SetupRedirectPage({
  params,
}: SetupRedirectPageProps) {
  const { tenantSlug } = await params;

  redirect(`/${tenantSlug}/admin/imports`);
}
