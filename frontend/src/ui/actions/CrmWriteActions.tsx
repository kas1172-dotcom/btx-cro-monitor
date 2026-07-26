import { useMemo, useState } from "react";
import { createHubSpotTask, importProspectsToHubSpot } from "../../app/backendApi.ts";
import type { Company, Contact } from "../../engine/brain/entities.ts";

type Mode = "closed" | "company_form" | "company_preview" | "task_form" | "task_preview";

interface CrmWriteActionsProps {
  company: Company;
  contact?: Contact;
  variant?: "account" | "prospect" | "queue";
  defaultTaskSubject?: string;
  defaultTaskBody?: string;
  environment?: "sandbox" | "developer" | "production" | "none";
  writeConnected?: boolean;
}

function keyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hubspotCompanyRef(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.startsWith("hubspot-company-") ? id : `hubspot-company-${id}`;
}

export function CrmWriteActions({
  company,
  contact,
  variant = "account",
  defaultTaskSubject,
  defaultTaskBody,
  environment = "none",
  writeConnected = false,
}: CrmWriteActionsProps) {
  const [mode, setMode] = useState<Mode>("closed");
  const [companyName, setCompanyName] = useState(company.name);
  const [domain, setDomain] = useState(company.domains?.[0] ?? company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/u, "") ?? "");
  const [city, setCity] = useState(company.location.city ?? "");
  const [state, setRegion] = useState(company.location.state ?? "");
  const [relationship, setRelationship] = useState<"customer" | "prospect">(company.relationship === "customer" ? "customer" : "prospect");
  const [program, setProgram] = useState(company.known_programs?.[0] ?? "");
  const [notes, setNotes] = useState("");
  const [taskSubject, setTaskSubject] = useState(defaultTaskSubject ?? `Follow up with ${company.name}`);
  const [taskBody, setTaskBody] = useState(defaultTaskBody ?? `Review next step for ${company.name}.`);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [hubspotCompanyId, setHubspotCompanyId] = useState(company.hubspot_company_id ?? "");

  const companyKey = useMemo(() => `crm-company:${keyPart(companyName || company.id)}:${keyPart(domain || "no-domain")}`, [company.id, companyName, domain]);
  const taskKey = useMemo(() => `crm-task:${company.id}:${keyPart(taskSubject)}`, [company.id, taskSubject]);
  const writesAllowed = writeConnected && (environment === "sandbox" || environment === "developer");

  async function confirmCompany() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await importProspectsToHubSpot([
        {
          row_id: companyKey,
          company: {
            name: companyName,
            domain,
            city,
            state,
            relationship,
            program,
            notes,
          },
        },
      ], companyKey);
      const row = response.rows[0];
      if (!row || row.status === "failed" || !row.company_id) throw new Error(row?.reason ?? "HubSpot did not return a company id.");
      setHubspotCompanyId(row.company_id);
      setResult(`HubSpot company ${row.company_id} created or verified${row.company_record_url ? `: ${row.company_record_url}` : ""}.`);
      setMode("closed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Company creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmTask() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await createHubSpotTask({
        title: taskSubject,
        body: taskBody,
        dueAt: dueDate || undefined,
        priority,
        companyId: hubspotCompanyRef(hubspotCompanyId || company.hubspot_company_id),
        contactId: contact?.id?.startsWith("hubspot-contact-") ? contact.id : undefined,
        idempotencyKey: taskKey,
      });
      setResult(`HubSpot task ${response.id} ${response.duplicate ? "already existed" : "created or verified"}: ${response.record_url}`);
      setMode("closed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crm-write-actions">
      <div className="crm-write-buttons">
        {variant !== "queue" && <button type="button" onClick={() => setMode("company_form")}>Add company to HubSpot</button>}
        <button type="button" onClick={() => setMode("task_form")}>Create task in HubSpot</button>
      </div>
      {result && <p className="crm-write-result">{result}</p>}
      {error && <p className="crm-write-error" role="alert">{error}</p>}

      {mode === "company_form" && (
        <div className="crm-write-form">
          <label>Legal name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
          <label>Domain<input value={domain} onChange={(event) => setDomain(event.target.value)} /></label>
          <label>City<input value={city} onChange={(event) => setCity(event.target.value)} /></label>
          <label>State<input value={state} onChange={(event) => setRegion(event.target.value)} /></label>
          <label>Relationship<select value={relationship} onChange={(event) => setRelationship(event.target.value as "customer" | "prospect")}><option value="prospect">Prospect</option><option value="customer">Customer</option></select></label>
          <label>Program<input value={program} onChange={(event) => setProgram(event.target.value)} /></label>
          <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <div><button type="button" onClick={() => setMode("company_preview")}>Preview</button><button type="button" onClick={() => setMode("closed")}>Cancel</button></div>
        </div>
      )}

      {mode === "company_preview" && (
        <div className="crm-write-preview">
          <strong>Confirm HubSpot company write</strong>
          <p>Portal environment: {environment}. Object: company. Approval: explicit confirmation required.</p>
          <p>{companyName || "Unnamed company"} · {domain || "no domain"} · {city}{state ? `, ${state}` : ""} · {relationship}</p>
          {program && <p>Program: {program}</p>}
          {notes && <p>Notes: {notes}</p>}
          <p>Idempotency key: {companyKey}</p>
          <p>Verification plan: retrieve the company by returned HubSpot ID and confirm its association fields.</p>
          {!writesAllowed && <p role="alert">Execution is disabled until the source registry confirms a sandbox or developer portal.</p>}
          <div><button type="button" disabled={busy || !writesAllowed} onClick={() => void confirmCompany()}>{busy ? "Creating..." : "Confirm create"}</button><button type="button" onClick={() => setMode("company_form")}>Back</button></div>
        </div>
      )}

      {mode === "task_form" && (
        <div className="crm-write-form">
          <label>Subject<input value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)} /></label>
          <label>Notes<textarea value={taskBody} onChange={(event) => setTaskBody(event.target.value)} /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          <div><button type="button" onClick={() => setMode("task_preview")}>Preview</button><button type="button" onClick={() => setMode("closed")}>Cancel</button></div>
        </div>
      )}

      {mode === "task_preview" && (
        <div className="crm-write-preview">
          <strong>Confirm HubSpot task write</strong>
          <p>Portal environment: {environment}. Object: task. Approval: explicit confirmation required.</p>
          <p>{taskSubject}</p>
          <p>{company.name}{contact ? ` · ${contact.name}` : ""}{dueDate ? ` · due ${dueDate}` : ""} · {priority}</p>
          <p>{hubspotCompanyId || company.hubspot_company_id ? "Associated to HubSpot company." : "No HubSpot company association yet. Add company first if this should attach to a company record."}</p>
          <p>{taskBody}</p>
          <p>Idempotency key: {taskKey}</p>
          <p>Verification plan: retrieve the task by returned HubSpot ID and confirm the target company association.</p>
          {!writesAllowed && <p role="alert">Execution is disabled until the source registry confirms a sandbox or developer portal.</p>}
          <div><button type="button" disabled={busy || !writesAllowed} onClick={() => void confirmTask()}>{busy ? "Creating..." : "Confirm create"}</button><button type="button" onClick={() => setMode("task_form")}>Back</button></div>
        </div>
      )}
    </div>
  );
}
