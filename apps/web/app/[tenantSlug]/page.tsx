import { redirect } from "next/navigation";

type TenantHomePageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function TenantHomePage({ params }: TenantHomePageProps) {
  const { tenantSlug } = await params;

  redirect(`/${tenantSlug}/field`);
}
