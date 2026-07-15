import { redirect } from "next/navigation";

// The setup ("Zapusk") screen was merged into the admin settings page. This
// route stays only to keep old bookmarks and links working: it forwards any
// query string on to the merged page.
type SetupRedirectPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetupRedirectPage({
  params,
  searchParams,
}: SetupRedirectPageProps) {
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
