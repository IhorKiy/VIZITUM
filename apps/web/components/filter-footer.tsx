import type { ReactNode } from "react";

// Rich-text tags for the `filterResultCount` messages, so the count itself
// stands out from the sentence around it without each page repeating the tag.
export const filterCountTags = {
  b: (chunks: ReactNode) => <b>{chunks}</b>,
};

type FilterFooterProps = {
  // Omitted by screens that already show the match count outside the panel,
  // where repeating it here would just say the same number twice.
  resultText?: ReactNode;
  resetHref?: string;
  resetLabel: string;
};

// Closing row of a filter panel: how many rows the current filters match, and
// the way back out of them. Reset only appears while a filter is active.
export function FilterFooter({
  resultText,
  resetHref,
  resetLabel,
}: FilterFooterProps) {
  return (
    <div className="filter-footer">
      {resultText ? <p className="filter-result-count">{resultText}</p> : null}
      {resetHref ? (
        <a className="secondary-button" href={resetHref}>
          {resetLabel}
        </a>
      ) : null}
    </div>
  );
}
