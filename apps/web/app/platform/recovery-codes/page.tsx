import { redirect } from "next/navigation";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  clearRecoveryCodes,
  takeRecoveryCodes,
} from "../../../lib/platform-mfa-challenge";

// Shown exactly once, immediately after enrolment.
//
// These codes are the only way back into the console if the authenticator is
// lost — there is no administrator above the platform owner to reset it. The
// API stores only their hashes, so this screen is the single moment they
// exist in readable form; reloading after dismissing it will not bring them
// back, which the copy says plainly.
export default async function PlatformRecoveryCodesPage() {
  const recoveryCodes = await takeRecoveryCodes();

  if (!recoveryCodes || recoveryCodes.length === 0) {
    redirect("/platform/tenants");
  }

  async function continueAction() {
    "use server";

    await clearRecoveryCodes();
    redirect("/platform/tenants");
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="recovery-codes-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">Platform</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">Two-factor authentication</p>
          <h1 id="recovery-codes-title">Save your recovery codes</h1>
          <p className="login-copy">
            Each code works once, and only these {recoveryCodes.length} exist.
            They are the only way into the console if you lose your
            authenticator — nobody can reset this for you. Store them somewhere
            you can reach without your phone. This is the only time they will be
            shown.
          </p>
        </div>

        <ul className="recovery-code-list">
          {recoveryCodes.map((code) => (
            <li key={code}>
              <code className="copyable-value">{code}</code>
            </li>
          ))}
        </ul>

        <form action={continueAction}>
          <PendingSubmitButton
            className="primary-button"
            pendingLabel="Opening the console..."
          >
            I have saved them — continue
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
