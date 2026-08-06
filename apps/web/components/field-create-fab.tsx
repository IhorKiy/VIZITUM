"use client";

import { useRouter } from "next/navigation";

import { PlusIcon } from "./icons";

type FieldCreateFabProps = {
  // Tenant-relative task list, e.g. "/acme/field/tasks" — where the dialog
  // this opens is mounted.
  tasksHref: string;
  // Icon-only control, so this is the whole accessible name.
  label: string;
};

/**
 * The field zone's one create action, sitting in the middle of the bottom nav
 * rather than floating over a single screen. A rep records what they were just
 * told at a location from wherever they are — the route, the planner, the
 * history — not only from the task list they may not be on.
 *
 * It opens the create dialog by putting `?create=1` on the task list, which is
 * the only way in now (components/create-own-task-modal.tsx watches that
 * param). A plain anchor to `/field/tasks?create=1` would do everywhere except
 * on the task list itself, where it would drop the filters the rep is looking
 * at — so the current query is read and added to, and only a rep somewhere
 * else navigates.
 *
 * That router call is a client-side navigation, which the field zone otherwise
 * avoids: a rep with no signal gets no cached shell from it (see the preamble
 * of tests/web-field-zone-anchors.test.ts, which counts anchors but cannot see
 * a programmatic push). Accepted here because the alternative loses the
 * filters, and because this button only ever opens a dialog on a screen the
 * rep can reach from the nav beside it.
 */
export function FieldCreateFab({ tasksHref, label }: FieldCreateFabProps) {
  const router = useRouter();

  // window rather than usePathname/useSearchParams: this needs the values once,
  // at click time, and reading them as hooks would put a useSearchParams caller
  // in the shell every field page renders.
  function openCreateDialog() {
    if (window.location.pathname !== tasksHref) {
      router.push(`${tasksHref}?create=1`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set("create", "1");
    router.replace(`${tasksHref}?${params.toString()}`, { scroll: false });
  }

  return (
    <button
      aria-haspopup="dialog"
      aria-label={label}
      className="mobile-nav-fab"
      onClick={openCreateDialog}
      title={label}
      type="button"
    >
      <PlusIcon size={26} />
    </button>
  );
}
