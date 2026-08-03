import { redirect } from "next/navigation";

// The chains screen was merged into the combined Locations / Chains page. This
// route stays only to keep old bookmarks and links working: it forwards the
// old query params under their chain-namespaced names on the merged page and
// opens the Chains accordion.
type ChainsRedirectPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FORWARDED_PARAMS: Record<string, string> = {
  created: "chainCreated",
  updated: "chainUpdated",
  error: "chainError",
  search: "chainSearch",
  status: "chainStatus",
};

export default async function ChainsRedirectPage({
  params,
  searchParams,
}: ChainsRedirectPageProps) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const forwarded = new URLSearchParams({ open: "chains" });
  for (const [key, value] of Object.entries(query)) {
    const target = FORWARDED_PARAMS[key];

    if (!target) {
      continue;
    }

    if (typeof value === "string") {
      forwarded.set(target, value);
    } else if (Array.isArray(value) && value.length > 0) {
      forwarded.set(target, value[value.length - 1]);
    }
  }

  redirect(`/${tenantSlug}/admin/locations?${forwarded.toString()}`);
}
