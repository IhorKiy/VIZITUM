import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { InfoHint } from "../../../../components/info-hint";
import { InviteUserModal } from "../../../../components/invite-user-modal";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { RoleCheckbox } from "../../../../components/role-checkbox";
import { UserNameField } from "../../../../components/user-name-field";
import {
  addAdminUserRole,
  deleteAdminUser,
  getCurrentSession,
  inviteAdminUser,
  listAdminInvites,
  listAdminUsers,
  removeAdminUserRole,
  resendAdminInvite,
  updateAdminUser,
  type InviteHistoryItem,
  type TenantRoleCode,
  type TenantUser,
} from "../../../../lib/api-client";
import { formatDateTime, formatEnumLabel } from "../../../../lib/format";
import { TENANT_ROLES } from "../../../../lib/tenant-roles";

type AdminUsersPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    error?: string;
    message?: string;
    inviteEmail?: string;
    inviteToken?: string;
    invited?: string;
    role?: string;
    status?: string;
    deleted?: string;
  }>;
};

export default async function AdminUsersPage({
  params,
  searchParams,
}: AdminUsersPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.users"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);

  async function inviteUserAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim();
    const roleCodes = TENANT_ROLES.filter(
      (roleCode) => formData.get(roleCode) === "on",
    );

    if (!email || roleCodes.length === 0) {
      redirect(`/${tenantSlug}/admin/users?error=invite`);
    }

    const result = await inviteAdminUser({ email, roleCodes });

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=invite&message=${encodeURIComponent(result.message)}`,
      );
    }

    const query = new URLSearchParams({
      inviteEmail: result.data.email,
      inviteToken: result.data.token,
      invited: "1",
    });

    redirect(`/${tenantSlug}/admin/users?${query.toString()}`);
  }

  async function resendInviteAction(formData: FormData) {
    "use server";

    const inviteId = String(formData.get("inviteId") ?? "").trim();

    if (!inviteId) {
      redirect(`/${tenantSlug}/admin/users?error=invite`);
    }

    const result = await resendAdminInvite(inviteId);

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=invite&message=${encodeURIComponent(result.message)}`,
      );
    }

    const query = new URLSearchParams({
      inviteEmail: result.data.email,
      inviteToken: result.data.token,
      invited: "resent",
    });

    redirect(`/${tenantSlug}/admin/users?${query.toString()}`);
  }

  async function updateUserStatusAction(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();
    const status = normalizeUserStatus(formData.get("status"));

    if (!userId || !status) {
      redirect(`/${tenantSlug}/admin/users?error=status`);
    }

    const result = await updateAdminUser(userId, { status });

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=status&message=${encodeURIComponent(result.message)}`,
      );
    }

    redirect(`/${tenantSlug}/admin/users?status=updated`);
  }

  async function addRoleAction(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();
    const roleCode = normalizeRoleCode(formData.get("roleCode"));

    if (!userId || !roleCode) {
      redirect(`/${tenantSlug}/admin/users?error=role`);
    }

    const result = await addAdminUserRole(userId, roleCode);

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=role&message=${encodeURIComponent(result.message)}`,
      );
    }

    redirect(`/${tenantSlug}/admin/users?role=updated`);
  }

  async function removeRoleAction(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();
    const roleCode = normalizeRoleCode(formData.get("roleCode"));

    if (!userId || !roleCode) {
      redirect(`/${tenantSlug}/admin/users?error=role`);
    }

    const result = await removeAdminUserRole(userId, roleCode);

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=role&message=${encodeURIComponent(result.message)}`,
      );
    }

    redirect(`/${tenantSlug}/admin/users?role=updated`);
  }

  async function updateUserNameAction(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();

    if (!userId || !name) {
      redirect(`/${tenantSlug}/admin/users?error=status`);
    }

    const result = await updateAdminUser(userId, { name });

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=status&message=${encodeURIComponent(result.message)}`,
      );
    }

    redirect(`/${tenantSlug}/admin/users?status=updated`);
  }

  async function deleteUserAction(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();

    if (!userId) {
      redirect(`/${tenantSlug}/admin/users?error=delete`);
    }

    const result = await deleteAdminUser(userId);

    if (!result.ok) {
      redirect(
        `/${tenantSlug}/admin/users?error=delete&message=${encodeURIComponent(result.message)}`,
      );
    }

    redirect(`/${tenantSlug}/admin/users?deleted=1`);
  }

  const [usersResult, invitesResult, sessionResult] = await Promise.all([
    listAdminUsers(),
    listAdminInvites(),
    getCurrentSession(),
  ]);
  const permissions = sessionResult.ok ? sessionResult.data.permissions : [];
  const canInviteAdmins = permissions.includes("admins.invite");
  const canManageAdmins = permissions.includes("admins.manage");
  const inviteLink = pageState.inviteToken
    ? `/${tenantSlug}/invites/accept?token=${encodeURIComponent(
        pageState.inviteToken,
      )}`
    : null;

  if (!usersResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-users">
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
            <p>{usersResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const users = usersResult.data.items;
  const activeCount = users.filter((user) => user.status === "active").length;
  const managerCount = users.filter((user) =>
    user.roleCodes.includes("team_manager"),
  ).length;
  const fieldCount = users.filter((user) =>
    user.roleCodes.includes("field_representative"),
  ).length;

  // The workspace user list is split into role sections shown in a fixed
  // order. A user is listed in every section whose role they hold, so a
  // multi-role account appears under each of its roles rather than being
  // forced into one bucket.
  const userGroups = [
    {
      key: "managers",
      title: t("groupManagers"),
      members: users.filter((user) => user.roleCodes.includes("team_manager")),
    },
    {
      key: "representatives",
      title: t("groupRepresentatives"),
      members: users.filter((user) =>
        user.roleCodes.includes("field_representative"),
      ),
    },
    {
      key: "admins",
      title: t("groupAdmins"),
      members: users.filter(
        (user) =>
          user.roleCodes.includes("company_admin") ||
          user.roleCodes.includes("tenant_superadmin"),
      ),
    },
  ];

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-users">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {pageState.invited ? (
        <section
          className="notice-panel success"
          aria-label={t("inviteStatusAria")}
        >
          <div>
            <p className="eyebrow">
              {pageState.invited === "resent"
                ? t("inviteRefreshed")
                : t("inviteCreated")}
            </p>
            <h2>{t("inviteReadyTitle")}</h2>
            <p>
              {t("inviteReadyBody", {
                forEmail: pageState.inviteEmail
                  ? t("inviteForEmail", { email: pageState.inviteEmail })
                  : "",
              })}
            </p>
            {inviteLink ? (
              <code className="copyable-value">{inviteLink}</code>
            ) : null}
          </div>
        </section>
      ) : null}

      {pageState.status || pageState.role || pageState.deleted ? (
        <section
          className="notice-panel success"
          aria-label={t("userUpdateAria")}
        >
          <div>
            <p className="eyebrow">{t("userUpdatedEyebrow")}</p>
            <h2>
              {pageState.deleted
                ? t("userDeletedTitle")
                : t("accessUpdatedTitle")}
            </h2>
            <p>{t("userUpdatedBody")}</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section
          className="notice-panel danger"
          aria-label={t("userErrorAria")}
        >
          <div>
            <p className="eyebrow">{t("errorEyebrow")}</p>
            <h2>{t("errorTitle")}</h2>
            <p>{pageState.message ?? t("errorFallback")}</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("tenantUsers")}</p>
            <span className="status-pill active">{tCommon("labels.live")}</span>
          </header>
          <p className="metric-value">{usersResult.data.total}</p>
          <p className="small-label">
            {t("activeUsersCount", { count: activeCount })}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("adminSeats")}</p>
            <span className="status-pill info">{t("limit")}</span>
          </header>
          <p className="metric-value">
            {usersResult.data.activeAdminCount} / {usersResult.data.adminLimit}
          </p>
          <p className="small-label">{t("adminSeatsDetail")}</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("teamManagers")}</p>
            <span className="status-pill info">{t("role")}</span>
          </header>
          <p className="metric-value">{managerCount}</p>
          <p className="small-label">{t("teamManagersDetail")}</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("fieldReps")}</p>
            <span className="status-pill info">{t("role")}</span>
          </header>
          <p className="metric-value">{fieldCount}</p>
          <p className="small-label">{t("fieldRepsDetail")}</p>
        </article>
      </section>

      <section className="admin-users-grid">
        <details className="panel panel-collapsible admin-invites-panel">
          <summary className="panel-summary">
            <h2>{t("pendingInvites")}</h2>
          </summary>
          <p className="panel-summary-sub">{t("pendingInvitesBody")}</p>
          {invitesResult.ok ? (
            <InviteHistoryList
              invites={invitesResult.data}
              resendInviteAction={resendInviteAction}
            />
          ) : (
            <p className="empty-state">
              {t("inviteHistoryUnavailable", {
                message: invitesResult.message,
              })}
            </p>
          )}
        </details>

        <div className="panel admin-users-panel">
          <div className="panel-toolbar">
            <div className="panel-title-stack">
              <h2>{t("tenantUsers")}</h2>
              <p>{t("tenantUsersPanelBody")}</p>
            </div>
            <InviteUserModal
              action={inviteUserAction}
              canInviteAdmins={canInviteAdmins}
            />
          </div>
          {users.length > 0 ? (
            <div className="user-group-list">
              {userGroups.map((group) => (
                <details className="user-group" key={group.key}>
                  <summary className="user-group-summary">
                    <span className="user-group-title">{group.title}</span>
                    <span className="user-group-meta">
                      <span className="user-group-count">
                        {group.members.length}
                      </span>
                      <span className="disclosure-chevron" aria-hidden="true" />
                    </span>
                  </summary>
                  {group.members.length > 0 ? (
                    <div className="admin-user-list">
                      {group.members.map((user) => (
                        <UserRow
                          addRoleAction={addRoleAction}
                          canInviteAdmins={canInviteAdmins}
                          canManageAdmins={canManageAdmins}
                          deleteUserAction={deleteUserAction}
                          key={user.id}
                          removeRoleAction={removeRoleAction}
                          updateUserNameAction={updateUserNameAction}
                          updateUserStatusAction={updateUserStatusAction}
                          user={user}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">{t("groupEmpty")}</p>
                  )}
                </details>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t("noUsers")}</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function InviteHistoryList({
  invites,
  resendInviteAction,
}: {
  invites: InviteHistoryItem[];
  resendInviteAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  if (invites.length === 0) {
    return <p className="empty-state">{t("noInvites")}</p>;
  }

  return (
    <div className="admin-invite-list">
      {invites.map((invite) => (
        <article className="admin-invite-row" key={invite.id}>
          <header>
            <div>
              <h3>{invite.email}</h3>
              <p>
                {t("expires", {
                  date: formatDateTime(format, invite.expiresAt),
                })}
                {invite.acceptedAt
                  ? t("acceptedAt", {
                      date: formatDateTime(format, invite.acceptedAt),
                    })
                  : ""}
              </p>
            </div>
            <span className={`issue-badge ${inviteStatusTone(invite.status)}`}>
              {formatEnumLabel(tCommon, invite.status)}
            </span>
          </header>
          <div
            className="role-chip-list"
            aria-label={t("rolesAria", { name: invite.email })}
          >
            {invite.roleCodes.map((roleCode) => (
              <span className="role-chip" key={roleCode}>
                {formatEnumLabel(tCommon, roleCode)}
              </span>
            ))}
          </div>
          <div className="invite-meta-row">
            <span>
              {t("createdBy", {
                name: invite.createdBy?.name ?? t("system"),
                date: formatDateTime(format, invite.createdAt),
              })}
            </span>
            {invite.acceptedBy ? (
              <span>{t("acceptedBy", { name: invite.acceptedBy.name })}</span>
            ) : null}
          </div>
          {invite.status === "pending" &&
          !invite.roleCodes.includes("tenant_superadmin") ? (
            <form action={resendInviteAction} className="inline-control-form">
              <input name="inviteId" type="hidden" value={invite.id} />
              <PendingSubmitButton
                className="secondary-button"
                pendingLabel={t("refreshing")}
              >
                {t("resendInvite")}
              </PendingSubmitButton>
            </form>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function UserRow({
  addRoleAction,
  canInviteAdmins,
  canManageAdmins,
  deleteUserAction,
  removeRoleAction,
  updateUserNameAction,
  updateUserStatusAction,
  user,
}: {
  addRoleAction: (formData: FormData) => Promise<void>;
  canInviteAdmins: boolean;
  canManageAdmins: boolean;
  deleteUserAction: (formData: FormData) => Promise<void>;
  removeRoleAction: (formData: FormData) => Promise<void>;
  updateUserNameAction: (formData: FormData) => Promise<void>;
  updateUserStatusAction: (formData: FormData) => Promise<void>;
  user: TenantUser;
}) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const isSuperadmin = user.roleCodes.includes("tenant_superadmin");
  const isCompanyAdmin = user.roleCodes.includes("company_admin");
  const actionsLocked = isSuperadmin || (isCompanyAdmin && !canManageAdmins);
  const isOnlyRole = user.roleCodes.length <= 1;
  const nextStatus = user.status === "suspended" ? "active" : "suspended";

  return (
    // Exclusive-accordion disclosure: the shared `name` keeps only one user
    // expanded at a time; collapsed rows show just the identity summary and
    // the management controls stay hidden until a row is opened.
    <details className="admin-user-row admin-user-disclosure" name="admin-user">
      <summary className="admin-user-summary">
        <div className="admin-user-summary-lead">
          <div className="admin-user-name-row">
            <UserNameField
              canEdit={!actionsLocked}
              name={user.name}
              updateNameAction={updateUserNameAction}
              userId={user.id}
            />
            {isSuperadmin ? (
              <>
                <span className="superadmin-badge">{t("superadminBadge")}</span>
                <InfoHint
                  label={t("superadminBadge")}
                  text={t("superadminBody", { email: user.email })}
                />
              </>
            ) : null}
          </div>
          <p>{user.email}</p>
        </div>
        <div className="admin-user-summary-meta">
          <span className={`status-pill ${statusTone(user.status)}`}>
            {formatEnumLabel(tCommon, user.status)}
          </span>
          <span className="disclosure-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="admin-user-body">
        {isSuperadmin ? (
          <p className="small-label">{t("superadminLocked")}</p>
        ) : (
          <>
            <div
              className="role-checkbox-list"
              role="group"
              aria-label={t("rolesAria", { name: user.name })}
            >
              {TENANT_ROLES.map((roleCode) => {
                const hasRole = user.roleCodes.includes(roleCode);
                const label = formatEnumLabel(tCommon, roleCode);
                // Granting company_admin is gated server-side by admins.invite
                // (like inviting one), not admins.manage; the last remaining
                // role can never be removed (a user must keep at least one).
                const disabled =
                  actionsLocked ||
                  (roleCode === "company_admin" &&
                    !hasRole &&
                    !canInviteAdmins) ||
                  (hasRole && isOnlyRole);

                return (
                  <RoleCheckbox
                    addMessage={t("confirmAddRole", {
                      name: user.name,
                      role: label,
                    })}
                    addRoleAction={addRoleAction}
                    checked={hasRole}
                    disabled={disabled}
                    key={roleCode}
                    label={label}
                    removeMessage={t("confirmRemoveRole", {
                      name: user.name,
                      role: label,
                    })}
                    removeRoleAction={removeRoleAction}
                    roleCode={roleCode}
                    userId={user.id}
                  />
                );
              })}
            </div>

            <div className="user-actions-grid">
              <form
                action={updateUserStatusAction}
                className="inline-control-form"
              >
                <input name="userId" type="hidden" value={user.id} />
                <input name="status" type="hidden" value={nextStatus} />
                <PendingSubmitButton
                  className="secondary-button"
                  disabled={actionsLocked}
                  pendingLabel={tCommon("saving")}
                >
                  {nextStatus === "active" ? t("reactivate") : t("suspend")}
                </PendingSubmitButton>
              </form>

              {isCompanyAdmin ? (
                <form action={deleteUserAction} className="inline-control-form">
                  <input name="userId" type="hidden" value={user.id} />
                  <PendingSubmitButton
                    className="secondary-button danger"
                    disabled={actionsLocked}
                    pendingLabel={t("deleting")}
                  >
                    {t("delete")}
                  </PendingSubmitButton>
                </form>
              ) : null}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function normalizeRoleCode(
  value: FormDataEntryValue | null,
): TenantRoleCode | null {
  if (
    value === "company_admin" ||
    value === "team_manager" ||
    value === "field_representative"
  ) {
    return value;
  }

  return null;
}

function normalizeUserStatus(
  value: FormDataEntryValue | null,
): "active" | "suspended" | null {
  if (value === "active" || value === "suspended") {
    return value;
  }

  return null;
}

function inviteStatusTone(
  status: InviteHistoryItem["status"],
): "error" | "success" | "warning" {
  if (status === "accepted") {
    return "success";
  }

  return status === "pending" ? "warning" : "error";
}

function statusTone(
  status: TenantUser["status"],
): "active" | "info" | "warning" {
  if (status === "active") {
    return "active";
  }

  if (status === "invited") {
    return "info";
  }

  return "warning";
}
