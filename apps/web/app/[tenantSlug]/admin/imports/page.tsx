import { redirect } from "next/navigation";

// The imports screen was merged into the admin settings page. This route stays
// only to keep old bookmarks and links working: it forwards any validation
// query string on to the merged page.
type ImportsRedirectPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ImportsRedirectPage({
  params,
  searchParams,
}: ImportsRedirectPageProps) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      forwarded.set(key, value);
    } else if (Array.isArray(value) && value.length > 0) {
      forwarded.set(key, value[value.length - 1]);
    }
  }

  const queryString = forwarded.toString();
  redirect(
    `/${tenantSlug}/admin/settings${queryString ? `?${queryString}` : ""}`,
  );
}
