import { redirect } from "next/navigation";

type AdminIndexPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function AdminIndexPage({ params }: AdminIndexPageProps) {
  const { tenantSlug } = await params;

  redirect(`/${tenantSlug}/admin/settings`);
}
