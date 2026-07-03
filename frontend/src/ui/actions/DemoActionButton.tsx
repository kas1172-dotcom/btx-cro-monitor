import type { KeyboardEvent, MouseEvent } from "react";
import { openDemoAction } from "../../store/store.ts";
import type { DemoActionNotice } from "../../store/store.ts";

export function DemoActionButton({ action, label }: { action: DemoActionNotice; label: string }) {
  function open(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    openDemoAction(action);
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className="demo-action-btn"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      {label}
    </span>
  );
}
