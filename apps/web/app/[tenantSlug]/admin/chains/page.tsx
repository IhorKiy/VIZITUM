import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  createAdminChain,
  listAdminChains,
  updateAdminChain,
  type Chain,
  type ChainStatus,
} from "../../../../lib/api-client";
import {
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";

type AdminChainsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    error?: string;
    search?: string;
    status?: string;
    created?: string;
    updated?: string;
  }>;
};

const chainStatuses: ChainStatus[] = ["active", "archived"];

export default async function AdminChainsPage({
  params,
  searchParams,
}: AdminChainsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.chains"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);
  const selectedStatus = normalizeStatus(pageState.status);
  const search = normalizeFilterValue(pageState.search);
  const hasFilters = Boolean(selectedStatus || search);

  const query = new URLSearchParams({ pageSize: "100" });

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (search) {
    query.set("search", search);
  }

  async function createChainAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    const notes = normalizeOptionalField(formData.get("notes"));

    if (!name) {
      redirect(`/${tenantSlug}/admin/chains?error=1`);
    }

    const result = await createAdminChain({ name, externalCode, notes });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/chains?error=1`);
    }

    redirect(`/${tenantSlug}/admin/chains?created=1`);
  }

  async function updateChainAction(formData: FormData) {
    "use server";

    const chainId = getFormString(formData, "chainId").trim();
    const name = getFormString(formData, "name").trim();
    const externalCode = normalizeOptionalField(formData.get("externalCode"));
    const notes = normalizeOptionalField(formData.get("notes"));
    const status = normalizeStatus(getFormString(formData, "status"));

    if (!chainId || !name || !status) {
      redirect(`/${tenantSlug}/admin/chains?error=1`);
    }

    const result = await updateAdminChain(chainId, {
      name,
      externalCode,
      notes,
      status,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/chains?error=1`);
    }

    redirect(`/${tenantSlug}/admin/chains?updated=1`);
  }

  const chainsResult = await listAdminChains(query.toString());

  if (!chainsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-chains">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{chainsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const chains = chainsResult.data.items;
  const activeCount = chains.filter(
    (chain) => chain.status === "active",
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-chains">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {pageState.created ? (
        <DismissableNotice
          ariaLabel={t("createdAria")}
          body={t("createdBody")}
          clearParams={["created"]}
          eyebrow={t("createdEyebrow")}
          title={t("createdTitle")}
          tone="success"
        />
      ) : null}

      {pageState.updated ? (
        <DismissableNotice
          ariaLabel={t("updatedAria")}
          body={t("updatedBody")}
          clearParams={["updated"]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
          tone="danger"
        />
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("tenantChains")}</p>
            <span className="status-pill active">{tCommon("labels.live")}</span>
          </header>
          <p className="metric-value">{chainsResult.data.total}</p>
          <p className="small-label">
            {t("activeCount", { count: activeCount })}
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title-stack">
          <h2>{t("createTitle")}</h2>
          <p>{t("createBody")}</p>
        </div>
        <form action={createChainAction} className="visit-form compact">
          <label>
            {t("name")}
            <input name="name" required type="text" />
          </label>
          <label>
            {t("externalCode")}
            <input name="externalCode" type="text" />
          </label>
          <label>
            {t("notes")}
            <input name="notes" type="text" />
          </label>
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={tCommon("saving")}
          >
            {t("createChain")}
          </PendingSubmitButton>
        </form>
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>{t("chainList")}</h2>
            <p>
              {selectedStatus
                ? t("showingStatus", {
                    status: formatEnumLabel(tCommon, selectedStatus),
                    search: search ? t("searchSuffix", { search }) : "",
                  })
                : t("showingAll", {
                    search: search ? t("searchSuffix", { search }) : "",
                  })}
            </p>
          </div>
          <div className="filter-pills" aria-label={t("statusFiltersAria")}>
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildChainFilterHref(tenantSlug, null, search)}
            >
              {tCommon("all")}
            </a>
            {chainStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildChainFilterHref(tenantSlug, status, search)}
                key={status}
              >
                {formatEnumLabel(tCommon, status)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/admin/chains`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            {t("search")}
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder={t("searchPlaceholder")}
              type="text"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              {tCommon("applyFilters")}
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/admin/chains`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {chains.length > 0 ? (
          <div className="admin-user-list">
            {chains.map((chain) => (
              <ChainRow
                key={chain.id}
                chain={chain}
                updateChainAction={updateChainAction}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            {hasFilters ? (
              <div className="toolbar">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/chains`}
                >
                  {t("showAllChains")}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function ChainRow({
  chain,
  updateChainAction,
}: {
  chain: Chain;
  updateChainAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.chains");
  const tCommon = useTranslations("common");

  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{chain.name}</h3>
          {chain.externalCode ? <p>{chain.externalCode}</p> : null}
        </div>
        <span className={`status-pill ${statusTone(chain.status)}`}>
          {formatEnumLabel(tCommon, chain.status)}
        </span>
      </header>

      <form action={updateChainAction} className="visit-form compact">
        <input name="chainId" type="hidden" value={chain.id} />
        <label>
          {t("name")}
          <input defaultValue={chain.name} name="name" required />
        </label>
        <label>
          {t("externalCode")}
          <input defaultValue={chain.externalCode ?? ""} name="externalCode" />
        </label>
        <label>
          {t("notes")}
          <input defaultValue={chain.notes ?? ""} name="notes" />
        </label>
        <label>
          {t("status")}
          <select defaultValue={chain.status} name="status" required>
            {chainStatuses.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(tCommon, status)}
              </option>
            ))}
          </select>
        </label>
        <PendingSubmitButton
          className="secondary-button"
          pendingLabel={tCommon("saving")}
        >
          {t("saveChain")}
        </PendingSubmitButton>
      </form>
    </article>
  );
}

function buildChainFilterHref(
  tenantSlug: string,
  status: ChainStatus | null,
  search: string | null,
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (search) {
    query.set("search", search);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/admin/chains${suffix ? `?${suffix}` : ""}`;
}

function normalizeStatus(value: string | undefined): ChainStatus | null {
  if (value === "active" || value === "archived") {
    return value;
  }

  return null;
}

function normalizeOptionalField(
  value: FormDataEntryValue | null,
): string | null {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  return normalizedValue || null;
}
