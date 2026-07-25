import type { KeyboardEvent, MouseEvent } from "react";
import { navigateTo } from "../../app/router.ts";

export function AskButton({ prompt, label = "Ask" }: { prompt: string; label?: string }) {
  function open(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    navigateTo(`/ask?prompt=${encodeURIComponent(prompt)}`);
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className="ask-inline-button"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      {label}
    </span>
  );
}
