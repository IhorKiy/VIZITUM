import { redirect } from "next/navigation";

// Pilot review was folded into the "Pilot" admin section. This route stays only
// to keep old bookmarks/links working, forwarding to the merged page.
type ReviewRedirectPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function ReviewRedirectPage({
  params,
}: ReviewRedirectPageProps) {
  const { tenantSlug } = await params;
  redirect(`/${tenantSlug}/admin/pilot`);
}
