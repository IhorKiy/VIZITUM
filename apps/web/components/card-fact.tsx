import type { ReactNode } from "react";

type CardFactProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

// One icon-labelled fact inside a list card's <dl>: the icon stands in for the
// term visually while the sr-only text keeps it for screen readers.
export function CardFact({ icon, label, children }: CardFactProps) {
  return (
    <div className="list-card-fact">
      <dt>
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
