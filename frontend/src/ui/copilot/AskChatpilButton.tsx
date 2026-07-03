import type { KeyboardEvent, MouseEvent } from "react";
import { openCopilotWithPrompt } from "../../store/store.ts";

export function AskChatpilButton({ prompt, label = "Ask Chatpil" }: { prompt: string; label?: string }) {
  function open(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    openCopilotWithPrompt(prompt);
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className="ask-chatpil"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      {label}
    </span>
  );
}
