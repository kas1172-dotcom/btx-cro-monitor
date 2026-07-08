import { SETTINGS_SECTIONS } from "../../app/settingsSections.ts";
import { clearMemory } from "../../memory/localMemory.ts";
import { resetUiState, setState, useStore, type SettingsSection } from "../../store/store.ts";

function clearCurrentThread(area: string): void {
  window.localStorage.removeItem(`btx.chatpil.thread.${area}`);
  window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
}

function clearAllThreads(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("btx.chatpil.thread.")) window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
}

function resetDemo(): void {
  if (!window.confirm("Reset demo and clear all local state?")) return;
  clearAllThreads();
  clearMemory();
  resetUiState();
  window.location.reload();
}

function sectionCopy(section: SettingsSection): { title: string; body: string } {
  switch (section) {
    case "engine":
      return {
        title: "Engine tuning",
        body: "Editable scoring weights, thresholds, targets, capacity assumptions, and client profile controls land here in the next section.",
      };
    case "prompts":
      return {
        title: "Prompts & rubrics",
        body: "Agent prompt, rubric, gold example, and banned-vocabulary editors land here after engine settings are wired.",
      };
    case "connections":
      return {
        title: "Connections",
        body: "The user-facing connector registry and honest pilot connection flow move here in the Connections section.",
      };
    case "general":
      return {
        title: "General & history",
        body: "Manage local demo history and reset controls.",
      };
  }
}

export function SettingsWorkspace() {
  const { activeSettingsSection, activeBrainArea } = useStore();
  const active = SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection) ?? SETTINGS_SECTIONS[0];
  const copy = sectionCopy(active.id);

  return (
    <section className="settings-workspace">
      <div className="settings-head">
        <p className="eyebrow">Settings</p>
        <h1>{active.label}</h1>
        <p>{active.summary}</p>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              className={section.id === active.id ? "active" : ""}
              onClick={() => setState({ activeSettingsSection: section.id })}
            >
              <strong>{section.label}</strong>
              <span>{section.summary}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          <div className="panel-head">
            <h2>{copy.title}</h2>
          </div>
          {active.id === "general" ? (
            <div className="settings-actions">
              <button onClick={() => clearCurrentThread(activeBrainArea)}>
                <strong>Clear this chat</strong>
                <span>Remove the Chatpil thread stored for the current rail area.</span>
              </button>
              <button onClick={clearAllThreads}>
                <strong>Clear all chats</strong>
                <span>Remove every local Chatpil thread from this browser.</span>
              </button>
              <button onClick={clearMemory}>
                <strong>Clear notes + activity</strong>
                <span>Remove saved notes, generated deliverable records, and activity history.</span>
              </button>
              <button onClick={resetDemo}>
                <strong>Reset demo</strong>
                <span>Clear local demo state and reload from the seeded snapshot.</span>
              </button>
            </div>
          ) : (
            <div className="settings-placeholder">
              <p>{copy.body}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
