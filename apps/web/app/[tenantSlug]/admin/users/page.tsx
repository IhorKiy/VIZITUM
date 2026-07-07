import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
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

const tenantRoles: Array<{ code: TenantRoleCode; label: string }> = [
  { code: "company_admin", label: "Company Admin" },
  { code: "team_manager", label: "Team Manager" },
  { code: "field_representative", label: "Field Representative" },
];

export default async function AdminUsersPage({
  params,
  searchParams,
}: AdminUsersPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;

  async function inviteUserAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim();
    const roleCodes = tenantRoles
      .map((role) => role.code)
      .filter((roleCode) => formData.get(roleCode) === "on");

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
            <p className="eyebrow">Company admin</p>
            <h1>Users and roles</h1>
            <p>
              Live tenant users are required in production before role setup can
              continue.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Tenant users are not connected</h2>
            <p>{usersResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const users = usersResult.data.items;
  const superadmin =
    users.find((user) => user.roleCodes.includes("tenant_superadmin")) ?? null;
  const activeCount = users.filter((user) => user.status === "active").length;
  const managerCount = users.filter((user) =>
    user.roleCodes.includes("team_manager"),
  ).length;
  const fieldCount = users.filter((user) =>
    user.roleCodes.includes("field_representative"),
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-users">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Users and roles</h1>
          <p>
            Invite users, review tenant access and keep Team Pilot roles aligned
            before field work starts.
          </p>
        </div>
      </header>

      {pageState.invited ? (
        <section className="notice-panel success" aria-label="Invite status">
          <div>
            <p className="eyebrow">
              {pageState.invited === "resent"
                ? "Invite refreshed"
                : "Invite created"}
            </p>
            <h2>User invite is ready</h2>
            <p>
              The invite was created
              {pageState.inviteEmail ? ` for ${pageState.inviteEmail}` : ""}.
              Share this link with the user through a trusted channel.
            </p>
            {inviteLink ? (
              <code className="copyable-value">{inviteLink}</code>
            ) : null}
          </div>
        </section>
      ) : null}

      {pageState.status || pageState.role || pageState.deleted ? (
        <section className="notice-panel success" aria-label="User update">
          <div>
            <p className="eyebrow">User updated</p>
            <h2>
              {pageState.deleted
                ? "The user was deleted"
                : "Tenant access was updated"}
            </h2>
            <p>
              The latest user list reflects the saved role, status or deletion
              change.
            </p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label="User error">
          <div>
            <p className="eyebrow">Update failed</p>
            <h2>Check the user details and try again</h2>
            <p>
              {pageState.message ??
                "Email, status and role changes must match the tenant's allowed Team Pilot roles."}
            </p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="User metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Tenant users</p>
            <span className="status-pill active">Live</span>
          </header>
          <p className="metric-value">{usersResult.data.total}</p>
          <p className="small-label">{activeCount} active users</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Admin seats</p>
            <span className="status-pill info">Limit</span>
          </header>
          <p className="metric-value">
            {usersResult.data.activeAdminCount} / {usersResult.data.adminLimit}
          </p>
          <p className="small-label">Active Company Admins in use</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Team managers</p>
            <span className="status-pill info">Role</span>
          </header>
          <p className="metric-value">{managerCount}</p>
          <p className="small-label">Full tenant operational view</p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Field reps</p>
            <span className="status-pill info">Role</span>
          </header>
          <p className="metric-value">{fieldCount}</p>
          <p className="small-label">Mobile-first field users</p>
        </article>
      </section>

      {superadmin ? (
        <section className="notice-panel" aria-label="Tenant superadmin">
          <div>
            <p className="eyebrow">Tenant superadmin</p>
            <h2>{superadmin.name}</h2>
            <p>
              {superadmin.email} — invited and replaced only by the platform
              owner. Company Admins cannot suspend, delete or re-role the
              superadmin.
            </p>
          </div>
        </section>
      ) : null}

      <section className="admin-users-grid">
        <div className="panel">
          <div className="panel-title-stack">
            <h2>Invite user</h2>
            <p>
              Invite links are generated after validation and should be shared
              through a trusted customer channel.
              {canInviteAdmins
                ? ""
                : " Only the tenant superadmin can invite Company Admins."}
            </p>
          </div>
          <form action={inviteUserAction} className="visit-form compact">
            <label>
              Email
              <input
                name="email"
                placeholder="name@company.com"
                required
                type="email"
              />
            </label>
            <fieldset className="checkbox-group">
              <legend>Roles</legend>
              {tenantRoles.map((role) => (
                <label key={role.code}>
                  <input
                    disabled={role.code === "company_admin" && !canInviteAdmins}
                    name={role.code}
                    type="checkbox"
                  />
                  <span>{role.label}</span>
                </label>
              ))}
            </fieldset>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Creating..."
            >
              Create invite
            </PendingSubmitButton>
          </form>
        </div>

        <div className="panel admin-invites-panel">
          <div className="panel-title-stack">
            <h2>Pending invites</h2>
            <p>
              Track open invite links, expiry and accepted/revoked history for
              this tenant.
            </p>
          </div>
          {invitesResult.ok ? (
            <InviteHistoryList
              invites={invitesResult.data}
              resendInviteAction={resendInviteAction}
            />
          ) : (
            <p className="empty-state">
              Invite history is unavailable right now: {invitesResult.message}
            </p>
          )}
        </div>

        <div className="panel admin-users-panel">
          <div className="panel-title-stack">
            <h2>Tenant users</h2>
            <p>
              Role and status changes apply immediately to the tenant session
              model.
            </p>
          </div>
          {users.length > 0 ? (
            <div className="admin-user-list">
              {users.map((user) => (
                <UserRow
                  addRoleAction={addRoleAction}
                  canInviteAdmins={canInviteAdmins}
                  canManageAdmins={canManageAdmins}
                  deleteUserAction={deleteUserAction}
                  key={user.id}
                  removeRoleAction={removeRoleAction}
                  updateUserStatusAction={updateUserStatusAction}
                  user={user}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No tenant users yet. Create the first invite to start onboarding.
            </p>
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
  if (invites.length === 0) {
    return (
      <p className="empty-state">
        Created invites will appear here with expiry and resend controls.
      </p>
    );
  }

  return (
    <div className="admin-invite-list">
      {invites.map((invite) => (
        <article className="admin-invite-row" key={invite.id}>
          <header>
            <div>
              <h3>{invite.email}</h3>
              <p>
                Expires {formatDateTime(invite.expiresAt)}
                {invite.acceptedAt
                  ? ` · Accepted ${formatDateTime(invite.acceptedAt)}`
                  : ""}
              </p>
            </div>
            <span className={`issue-badge ${inviteStatusTone(invite.status)}`}>
              {formatInviteStatus(invite.status)}
            </span>
          </header>
          <div className="role-chip-list" aria-label={`${invite.email} roles`}>
            {invite.roleCodes.map((roleCode) => (
              <span className="role-chip" key={roleCode}>
                {formatRole(roleCode)}
              </span>
            ))}
          </div>
          <div className="invite-meta-row">
            <span>
              Created by {invite.createdBy?.name ?? "System"} ·{" "}
              {formatDateTime(invite.createdAt)}
            </span>
            {invite.acceptedBy ? (
              <span>Accepted by {invite.acceptedBy.name}</span>
            ) : null}
          </div>
          {invite.status === "pending" &&
          !invite.roleCodes.includes("tenant_superadmin") ? (
            <form action={resendInviteAction} className="inline-control-form">
              <input name="inviteId" type="hidden" value={invite.id} />
              <PendingSubmitButton
                className="secondary-button"
                pendingLabel="Refreshing..."
              >
                Resend invite
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
  updateUserStatusAction,
  user,
}: {
  addRoleAction: (formData: FormData) => Promise<void>;
  canInviteAdmins: boolean;
  canManageAdmins: boolean;
  deleteUserAction: (formData: FormData) => Promise<void>;
  removeRoleAction: (formData: FormData) => Promise<void>;
  updateUserStatusAction: (formData: FormData) => Promise<void>;
  user: TenantUser;
}) {
  const isSuperadmin = user.roleCodes.includes("tenant_superadmin");
  const isCompanyAdmin = user.roleCodes.includes("company_admin");
  const actionsLocked = isSuperadmin || (isCompanyAdmin && !canManageAdmins);
  // Granting company_admin is gated server-side by admins.invite (like
  // inviting one), not admins.manage — keep this select in sync with
  // UsersService.addRole rather than reusing the manage-scoped flag above.
  const missingRoles = tenantRoles.filter(
    (role) =>
      !user.roleCodes.includes(role.code) &&
      (role.code !== "company_admin" || canInviteAdmins),
  );
  const canRemoveRole = user.roleCodes.length > 1 && !actionsLocked;
  const nextStatus = user.status === "suspended" ? "active" : "suspended";

  return (
    <article className="admin-user-row">
      <header>
        <div>
          <h3>{user.name}</h3>
          <p>{user.email}</p>
        </div>
        <span className={`status-pill ${statusTone(user.status)}`}>
          {formatStatus(user.status)}
        </span>
      </header>

      <div className="role-chip-list" aria-label={`${user.name} roles`}>
        {user.roleCodes.map((roleCode) => (
          <span className="role-chip" key={roleCode}>
            {formatRole(roleCode)}
          </span>
        ))}
      </div>

      {isSuperadmin ? (
        <p className="small-label">
          Managed by the platform owner — Company Admins cannot change this
          user.
        </p>
      ) : (
        <div className="user-actions-grid">
          <form action={updateUserStatusAction} className="inline-control-form">
            <input name="userId" type="hidden" value={user.id} />
            <input name="status" type="hidden" value={nextStatus} />
            <PendingSubmitButton
              className="secondary-button"
              disabled={actionsLocked}
              pendingLabel="Saving..."
            >
              {nextStatus === "active" ? "Reactivate" : "Suspend"}
            </PendingSubmitButton>
          </form>

          <form action={addRoleAction} className="inline-control-form">
            <input name="userId" type="hidden" value={user.id} />
            <select
              aria-label={`Add role to ${user.name}`}
              disabled={missingRoles.length === 0}
              name="roleCode"
              required
            >
              <option value="">Add role</option>
              {missingRoles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
            <PendingSubmitButton
              className="secondary-button"
              disabled={missingRoles.length === 0}
              pendingLabel="Saving..."
            >
              Add
            </PendingSubmitButton>
          </form>

          <form action={removeRoleAction} className="inline-control-form">
            <input name="userId" type="hidden" value={user.id} />
            <select
              aria-label={`Remove role from ${user.name}`}
              disabled={!canRemoveRole}
              name="roleCode"
              required
            >
              <option value="">Remove role</option>
              {user.roleCodes.map((roleCode) => (
                <option key={roleCode} value={roleCode}>
                  {formatRole(roleCode)}
                </option>
              ))}
            </select>
            <PendingSubmitButton
              className="secondary-button"
              disabled={!canRemoveRole}
              pendingLabel="Saving..."
            >
              Remove
            </PendingSubmitButton>
          </form>

          {isCompanyAdmin ? (
            <form action={deleteUserAction} className="inline-control-form">
              <input name="userId" type="hidden" value={user.id} />
              <PendingSubmitButton
                className="secondary-button danger"
                disabled={actionsLocked}
                pendingLabel="Deleting..."
              >
                Delete
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
      )}
    </article>
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

function formatRole(roleCode: TenantRoleCode): string {
  switch (roleCode) {
    case "tenant_superadmin":
      return "Tenant Superadmin";
    case "company_admin":
      return "Company Admin";
    case "team_manager":
      return "Team Manager";
    case "field_representative":
      return "Field Representative";
  }
}

function formatStatus(status: TenantUser["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "invited":
      return "Invited";
    case "suspended":
      return "Suspended";
  }
}

function formatInviteStatus(status: InviteHistoryItem["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
  }
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
