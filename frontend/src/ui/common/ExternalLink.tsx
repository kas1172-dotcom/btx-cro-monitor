import type { KeyboardEvent, MouseEvent } from "react";

export function ExternalLink({ href, label }: { href: string | undefined; label: string }) {
  if (!href) return null;

  function open(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className="external-link"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      {label}
    </span>
  );
}
