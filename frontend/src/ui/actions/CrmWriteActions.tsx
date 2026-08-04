import { useEffect, useMemo, useRef, useState } from "react";
import { createHubSpotTask, importProspectsToHubSpot } from "../../app/backendApi.ts";
import { createCrmSubmissionLock, crmWriteBlockReason, type CrmEntityIdentity } from "../../app/crmWriteSafety.ts";
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
  writeBlockReason?: string | null;
  currentRouteEntityId?: string | null;
}

function keyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hubspotCompanyRef(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.startsWith("hubspot-company-") ? id : `hubspot-company-${id}`;
}

function defaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date.toISOString().slice(0, 10);
}

export function CrmWriteActions({
  company,
  contact,
  variant = "account",
  defaultTaskSubject,
  defaultTaskBody,
  environment = "none",
  writeConnected = false,
  writeBlockReason: sourceWriteBlockReason = null,
  currentRouteEntityId = null,
}: CrmWriteActionsProps) {
  const entityIdRef = useRef(company.id);
  const submissionLockRef = useRef(createCrmSubmissionLock());
  const [mode, setMode] = useState<Mode>("closed");
  const [formEntityId, setFormEntityId] = useState(company.id);
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState(company.name);
  const [domain, setDomain] = useState(company.domains?.[0] ?? company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/u, "") ?? "");
  const [city, setCity] = useState(company.location.city ?? "");
  const [state, setRegion] = useState(company.location.state ?? "");
  const [relationship, setRelationship] = useState<"customer" | "prospect">(company.relationship === "customer" ? "customer" : "prospect");
  const [program, setProgram] = useState(company.known_programs?.[0] ?? "");
  const [notes, setNotes] = useState("");
  const [taskSubject, setTaskSubject] = useState(defaultTaskSubject ?? `Follow up with ${company.name}`);
  const [taskBody, setTaskBody] = useState(defaultTaskBody ?? `Review next step for ${company.name}.`);
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [priority, setPriority] = useState("normal");
  const [result, setResult] = useState<string>("");
  const [resultDetails, setResultDetails] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [hubspotCompanyId, setHubspotCompanyId] = useState(company.hubspot_company_id ?? "");

  useEffect(() => {
    entityIdRef.current = company.id;
    submissionLockRef.current = createCrmSubmissionLock();
    setMode("closed");
    setFormEntityId(company.id);
    setPreviewEntityId(null);
    setCompanyName(company.name);
    setDomain(company.domains?.[0] ?? company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/u, "") ?? "");
    setCity(company.location.city ?? "");
    setRegion(company.location.state ?? "");
    setRelationship(company.relationship === "customer" ? "customer" : "prospect");
    setProgram(company.known_programs?.[0] ?? "");
    setNotes("");
    setTaskSubject(defaultTaskSubject ?? `Follow up with ${company.name}`);
    setTaskBody(defaultTaskBody ?? `Review next step for ${company.name}.`);
    setDueDate(defaultDueDate());
    setPriority("normal");
    setResult("");
    setResultDetails(null);
    setError("");
    setBusy(false);
    setHubspotCompanyId(company.hubspot_company_id ?? "");
  }, [company.id, company.name, company.domains, company.website_url, company.location.city, company.location.state, company.relationship, company.known_programs, company.hubspot_company_id, defaultTaskBody, defaultTaskSubject]);

  const companyKey = useMemo(() => `crm-company:${keyPart(companyName || company.id)}:${keyPart(domain || "no-domain")}`, [company.id, companyName, domain]);
  const taskKey = useMemo(() => `crm-task:${company.id}:${keyPart(taskSubject)}`, [company.id, taskSubject]);
  const identity: CrmEntityIdentity = {
    formEntityId,
    targetEntityId: company.id,
    previewEntityId,
    routeEntityId: currentRouteEntityId,
  };
  const writeBlockReason = crmWriteBlockReason(identity)
    ?? (!writeConnected
      ? sourceWriteBlockReason ?? "Execution is disabled until the source registry confirms this portal is write-enabled."
      : null);
  const writesAllowed = writeBlockReason === null;

  async function confirmCompany() {
    if (!submissionLockRef.current.acquire()) return;
    const blocked = crmWriteBlockReason(identity);
    if (blocked || !writesAllowed) {
      setError(blocked ?? "CRM execution is disabled.");
      submissionLockRef.current.release();
      return;
    }
    const submittedEntityId = company.id;
    setBusy(true);
    setError("");
    setResult("");
    setResultDetails(null);
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
      if (entityIdRef.current === submittedEntityId) {
        setHubspotCompanyId(row.company_id);
        setResult("HubSpot company created or verified.");
        setResultDetails({ company_id: row.company_id, company_record_url: row.company_record_url, idempotency_key: companyKey, target_entity_id: submittedEntityId });
        setMode("closed");
        setPreviewEntityId(null);
      }
    } catch (err) {
      if (entityIdRef.current === submittedEntityId) setError(err instanceof Error ? err.message : "Company creation failed.");
    } finally {
      if (entityIdRef.current === submittedEntityId) setBusy(false);
      submissionLockRef.current.release();
    }
  }

  async function confirmTask() {
    if (!submissionLockRef.current.acquire()) return;
    const blocked = crmWriteBlockReason(identity);
    if (blocked || !writesAllowed) {
      setError(blocked ?? "CRM execution is disabled.");
      submissionLockRef.current.release();
      return;
    }
    const submittedEntityId = company.id;
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
      if (entityIdRef.current === submittedEntityId) {
        setResult(response.duplicate ? "HubSpot task already existed; duplicate submission was safely ignored." : "HubSpot task created or verified.");
        setResultDetails({ task_id: response.id, record_url: response.record_url, duplicate: response.duplicate, idempotency_key: taskKey, target_entity_id: submittedEntityId });
        setMode("closed");
        setPreviewEntityId(null);
      }
    } catch (err) {
      if (entityIdRef.current === submittedEntityId) setError(err instanceof Error ? err.message : "Task creation failed.");
    } finally {
      if (entityIdRef.current === submittedEntityId) setBusy(false);
      submissionLockRef.current.release();
    }
  }

  return (
    <div className="crm-write-actions">
      <div className="crm-write-buttons">
        {variant !== "queue" && <button type="button" onClick={() => setMode("company_form")}>Add company to HubSpot</button>}
        <button type="button" onClick={() => setMode("task_form")}>Create task in HubSpot</button>
      </div>
      {!writesAllowed && <p className="crm-write-disabled" role="note">{writeBlockReason}</p>}
      {result && (
        <div className="crm-write-result" role="status">
          <p>{result}</p>
          {typeof resultDetails?.company_id === "string" && <p>HubSpot company ID: {resultDetails.company_id}</p>}
          {typeof resultDetails?.task_id === "string" && <p>HubSpot task ID: {resultDetails.task_id}</p>}
          {typeof resultDetails?.record_url === "string" && <a href={resultDetails.record_url} target="_blank" rel="noreferrer">Open HubSpot record</a>}
          {typeof resultDetails?.company_record_url === "string" && <a href={resultDetails.company_record_url} target="_blank" rel="noreferrer">Open HubSpot company</a>}
          {resultDetails && <details><summary>Technical details</summary><pre>{JSON.stringify(resultDetails, null, 2)}</pre></details>}
        </div>
      )}
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
          <div><button type="button" onClick={() => { setPreviewEntityId(formEntityId); setMode("company_preview"); }}>Preview company record</button><button type="button" onClick={() => { setPreviewEntityId(null); setMode("closed"); }}>Cancel</button></div>
        </div>
      )}

      {mode === "company_preview" && (
        <div className="crm-write-preview">
          <strong>Confirm HubSpot company write</strong>
          <p>Portal environment: {environment}. Object: company. Approval: explicit confirmation required.</p>
          <p>{companyName || "Unnamed company"} · {domain || "no domain"} · {city}{state ? `, ${state}` : ""} · {relationship}</p>
          {program && <p>Program: {program}</p>}
          {notes && <p>Notes: {notes}</p>}
          <p>Idempotency protection: enabled.</p>
          <p>Verification plan: retrieve the company by returned HubSpot ID and confirm its association fields.</p>
          {!writesAllowed && <p role="alert">{writeBlockReason}</p>}
          <details><summary>Technical details</summary><pre>{JSON.stringify({ idempotency_key: companyKey, form_entity_id: formEntityId, preview_entity_id: previewEntityId, target_entity_id: company.id, route_entity_id: currentRouteEntityId }, null, 2)}</pre></details>
          <div><button type="button" disabled={busy || !writesAllowed} title={!writesAllowed ? writeBlockReason ?? "CRM writing is disabled." : undefined} onClick={() => void confirmCompany()}>{busy ? "Creating..." : "Create HubSpot company"}</button><button type="button" onClick={() => setMode("company_form")}>Back to edit</button></div>
        </div>
      )}

      {mode === "task_form" && (
        <div className="crm-write-form">
          <label>Subject<input value={taskSubject} onChange={(event) => setTaskSubject(event.target.value)} /></label>
          <label>Notes<textarea value={taskBody} onChange={(event) => setTaskBody(event.target.value)} /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          <div><button type="button" onClick={() => { setPreviewEntityId(formEntityId); setMode("task_preview"); }}>Preview task</button><button type="button" onClick={() => { setPreviewEntityId(null); setMode("closed"); }}>Cancel</button></div>
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
          <p>Idempotency protection: enabled.</p>
          <p>Verification plan: retrieve the task by returned HubSpot ID and confirm the target company association.</p>
          {!writesAllowed && <p role="alert">{writeBlockReason}</p>}
          <details><summary>Technical details</summary><pre>{JSON.stringify({ idempotency_key: taskKey, form_entity_id: formEntityId, preview_entity_id: previewEntityId, target_entity_id: company.id, route_entity_id: currentRouteEntityId, hubspot_company_id: hubspotCompanyId || company.hubspot_company_id }, null, 2)}</pre></details>
          <div><button type="button" disabled={busy || !writesAllowed} title={!writesAllowed ? writeBlockReason ?? "CRM writing is disabled." : undefined} onClick={() => void confirmTask()}>{busy ? "Creating..." : "Create HubSpot task"}</button><button type="button" onClick={() => setMode("task_form")}>Back to edit</button></div>
        </div>
      )}
    </div>
  );
}
