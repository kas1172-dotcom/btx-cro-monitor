from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
from typing import Any

from sqlalchemy.orm import Session

from btx_platform import models

RESULT_LIMIT = 8


class AssistantError(RuntimeError):
    def __init__(self, code: str, detail: str, *, status_code: int = 400) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code


@dataclass
class AssistantResult:
    content: str
    tool_activity: list[str]
    citations: list[dict[str, Any]]
    related_records: list[dict[str, Any]]
    action_draft: dict[str, Any] | None = None
    deliverable_draft: dict[str, Any] | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _route(source_type: str, record_id: str) -> str:
    if source_type == "account":
        return f"/accounts/{record_id}"
    if source_type == "work_item":
        return f"/work/{record_id}"
    if source_type == "deliverable":
        return f"/deliverables/{record_id}"
    if source_type == "program":
        return f"/programs/{record_id}"
    if source_type == "score":
        return f"/accounts/{record_id}"
    return "/ask"


def citation(
    *,
    source_type: str,
    record_id: str,
    title: str,
    claim: str,
    claim_classification: str,
    data_classification: str,
    relationship_status: str | None = None,
    route: str | None = None,
) -> dict[str, Any]:
    digest = hashlib.sha256(f"{source_type}:{record_id}:{title}:{claim}".encode("utf-8")).hexdigest()[:8]
    return {
        "id": f"{source_type}:{record_id}:{digest}",
        "source_type": source_type,
        "record_id": record_id,
        "title": title,
        "route": route or _route(source_type, record_id),
        "claim": claim,
        "claim_classification": claim_classification,
        "data_classification": data_classification,
        "relationship_status": relationship_status,
    }


def _source_classification(payload: dict | None, fallback: str = "internal") -> str:
    if isinstance(payload, dict):
        value = payload.get("dataClassification") or payload.get("data_classification")
        if isinstance(value, str):
            return value
        artifact = payload.get("artifact")
        if isinstance(artifact, dict):
            provenance = artifact.get("provenance")
            if isinstance(provenance, dict) and isinstance(provenance.get("classification"), str):
                return provenance["classification"]
    return fallback


def _conversation_title(message: str, account: models.CanonicalAccount | None = None) -> str:
    if account is not None:
        return f"Ask: {account.display_name or account.legal_name}"
    cleaned = " ".join(message.strip().split())
    return cleaned[:72] if cleaned else "New Ask conversation"


def _context_dict(context: Any | None) -> dict[str, Any]:
    if context is None:
        return {}
    if hasattr(context, "model_dump"):
        return {key: value for key, value in context.model_dump().items() if value}
    if isinstance(context, dict):
        allowed = {"account_id", "program_id", "work_item_id", "signal_id", "deliverable_id", "route"}
        return {key: value for key, value in context.items() if key in allowed and value}
    return {}


def apply_context(row: models.AssistantConversation, context: dict[str, Any]) -> None:
    merged = {**(row.context or {}), **context}
    row.context = merged or None
    row.related_account_id = merged.get("account_id")
    row.related_program_id = merged.get("program_id")
    row.related_work_item_id = merged.get("work_item_id")
    row.related_signal_id = merged.get("signal_id")
    row.related_deliverable_id = merged.get("deliverable_id")


def _messages(session: Session, conversation_id: str) -> list[models.AssistantMessage]:
    return (
        session.query(models.AssistantMessage)
        .filter(models.AssistantMessage.conversation_id == conversation_id)
        .order_by(models.AssistantMessage.created_at.asc(), models.AssistantMessage.id.asc())
        .all()
    )


def message_response(row: models.AssistantMessage) -> dict[str, Any]:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "status": row.status,
        "tool_activity": row.tool_activity or [],
        "citations": row.citations or [],
        "related_records": row.related_records or [],
        "action_draft": row.action_draft,
        "deliverable_draft": row.deliverable_draft,
        "created_at": row.created_at.isoformat(),
    }


def conversation_response(session: Session, row: models.AssistantConversation, *, include_messages: bool = False) -> dict[str, Any]:
    rows = _messages(session, row.id)
    last = rows[-1] if rows else None
    return {
        "id": row.id,
        "title": row.title,
        "status": row.status,
        "context": row.context,
        "related_account_id": row.related_account_id,
        "related_program_id": row.related_program_id,
        "related_work_item_id": row.related_work_item_id,
        "related_signal_id": row.related_signal_id,
        "related_deliverable_id": row.related_deliverable_id,
        "message_count": len(rows),
        "preview": last.content[:160] if last is not None else None,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "archived_at": row.archived_at.isoformat() if row.archived_at else None,
        "messages": [message_response(item) for item in rows] if include_messages else [],
    }


def get_conversation(session: Session, tenant_id: str, conversation_id: str) -> models.AssistantConversation | None:
    row = session.get(models.AssistantConversation, conversation_id)
    if row is None or row.tenant_id != tenant_id:
        return None
    return row


def create_conversation(
    session: Session,
    *,
    tenant_id: str,
    actor_user_id: str | None,
    title: str | None = None,
    context: Any | None = None,
) -> models.AssistantConversation:
    ctx = _context_dict(context)
    account = _account_by_id(session, tenant_id, ctx.get("account_id")) if ctx.get("account_id") else None
    row = models.AssistantConversation(
        tenant_id=tenant_id,
        title=title or _conversation_title("", account),
        status="active",
        created_by_user_id=actor_user_id,
        context=ctx or None,
        related_account_id=ctx.get("account_id"),
        related_program_id=ctx.get("program_id"),
        related_work_item_id=ctx.get("work_item_id"),
        related_signal_id=ctx.get("signal_id"),
        related_deliverable_id=ctx.get("deliverable_id"),
    )
    session.add(row)
    session.flush()
    return row


def rename_or_archive_conversation(
    row: models.AssistantConversation,
    *,
    title: str | None = None,
    status: str | None = None,
    context: Any | None = None,
) -> None:
    if title is not None:
        row.title = title.strip()
    if context is not None:
        apply_context(row, _context_dict(context))
    if status is not None:
        if status not in {"active", "archived"}:
            raise AssistantError("validation_error", f"Unknown conversation status {status!r}.", status_code=422)
        row.status = status
        row.archived_at = _now() if status == "archived" else None
    row.updated_at = _now()


def _account_by_id(session: Session, tenant_id: str, account_id: str | None) -> models.CanonicalAccount | None:
    if not account_id:
        return None
    row = session.get(models.CanonicalAccount, account_id)
    return row if row is not None and row.tenant_id == tenant_id else None


def _match_account(session: Session, tenant_id: str, message: str, context: dict[str, Any]) -> models.CanonicalAccount | None:
    account = _account_by_id(session, tenant_id, context.get("account_id"))
    if account is not None:
        return account
    lowered = message.lower()
    rows = (
        session.query(models.CanonicalAccount)
        .filter(models.CanonicalAccount.tenant_id == tenant_id)
        .order_by(models.CanonicalAccount.updated_at.desc(), models.CanonicalAccount.created_at.desc())
        .limit(RESULT_LIMIT * 3)
        .all()
    )
    for row in rows:
        candidates = [row.display_name, row.legal_name, row.domain, *(row.aliases or [])]
        if any(candidate and str(candidate).lower() in lowered for candidate in candidates):
            return row
    urgent = (
        session.query(models.WorkItem)
        .filter(models.WorkItem.tenant_id == tenant_id, models.WorkItem.status.notin_(["closed", "dismissed"]))
        .order_by(models.WorkItem.priority.desc(), models.WorkItem.updated_at.desc())
        .first()
    )
    if urgent and urgent.canonical_account_id:
        return _account_by_id(session, tenant_id, urgent.canonical_account_id)
    return rows[0] if rows else None


def _programs(session: Session, tenant_id: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    tenant = session.get(models.Tenant, tenant_id)
    metadata = tenant.demo_metadata if tenant and isinstance(tenant.demo_metadata, dict) else {}
    rows = metadata.get("programs") if isinstance(metadata.get("programs"), list) else []
    program_id = context.get("program_id")
    result = [item for item in rows if isinstance(item, dict)]
    if program_id:
        result = [item for item in result if item.get("id") == program_id]
    return result[:RESULT_LIMIT]


def _confirmed_relationships(session: Session, tenant_id: str, account_id: str) -> list[tuple[models.SignalAccountRelationship, models.IntelligenceSignal]]:
    rows = (
        session.query(models.SignalAccountRelationship, models.IntelligenceSignal)
        .join(models.IntelligenceSignal, models.SignalAccountRelationship.signal_id == models.IntelligenceSignal.id)
        .filter(
            models.SignalAccountRelationship.tenant_id == tenant_id,
            models.IntelligenceSignal.tenant_id == tenant_id,
            models.SignalAccountRelationship.canonical_account_id == account_id,
            models.SignalAccountRelationship.review_status == "confirmed",
        )
        .order_by(models.IntelligenceSignal.retrieved_at.desc())
        .limit(RESULT_LIMIT)
        .all()
    )
    return rows


def _pending_relationships(session: Session, tenant_id: str, account_id: str) -> list[tuple[models.SignalAccountRelationship, models.IntelligenceSignal]]:
    return (
        session.query(models.SignalAccountRelationship, models.IntelligenceSignal)
        .join(models.IntelligenceSignal, models.SignalAccountRelationship.signal_id == models.IntelligenceSignal.id)
        .filter(
            models.SignalAccountRelationship.tenant_id == tenant_id,
            models.IntelligenceSignal.tenant_id == tenant_id,
            models.SignalAccountRelationship.canonical_account_id == account_id,
            models.SignalAccountRelationship.review_status != "confirmed",
        )
        .order_by(models.IntelligenceSignal.retrieved_at.desc())
        .limit(RESULT_LIMIT)
        .all()
    )


def _scores(session: Session, tenant_id: str, account_id: str) -> list[models.ScoreSnapshot]:
    return (
        session.query(models.ScoreSnapshot)
        .filter(
            models.ScoreSnapshot.tenant_id == tenant_id,
            models.ScoreSnapshot.entity_type == "account",
            models.ScoreSnapshot.entity_id == account_id,
        )
        .order_by(models.ScoreSnapshot.calculated_at.desc())
        .limit(RESULT_LIMIT)
        .all()
    )


def _work_items(session: Session, tenant_id: str, account_id: str | None) -> list[models.WorkItem]:
    query = session.query(models.WorkItem).filter(models.WorkItem.tenant_id == tenant_id)
    if account_id:
        query = query.filter(models.WorkItem.canonical_account_id == account_id)
    return (
        query.filter(models.WorkItem.status.notin_(["closed", "dismissed"]))
        .order_by(models.WorkItem.priority.desc(), models.WorkItem.due_date.asc().nullslast(), models.WorkItem.updated_at.desc())
        .limit(RESULT_LIMIT)
        .all()
    )


def _deliverables(session: Session, tenant_id: str, account_id: str | None) -> list[models.Deliverable]:
    query = session.query(models.Deliverable).filter(models.Deliverable.tenant_id == tenant_id)
    rows = query.order_by(models.Deliverable.updated_at.desc()).limit(RESULT_LIMIT * 2).all()
    if account_id:
        rows = [row for row in rows if row.canonical_account_id == account_id or (row.entity_ids and account_id in row.entity_ids)]
    return rows[:RESULT_LIMIT]


def _signal_by_context(session: Session, tenant_id: str, signal_id: str | None) -> models.IntelligenceSignal | None:
    if not signal_id:
        return None
    row = session.get(models.IntelligenceSignal, signal_id)
    return row if row is not None and row.tenant_id == tenant_id else None


def _work_by_context(session: Session, tenant_id: str, work_item_id: str | None) -> models.WorkItem | None:
    if not work_item_id:
        return None
    row = session.get(models.WorkItem, work_item_id)
    return row if row is not None and row.tenant_id == tenant_id else None


def _deliverable_by_context(session: Session, tenant_id: str, deliverable_id: str | None) -> models.Deliverable | None:
    if not deliverable_id:
        return None
    row = session.get(models.Deliverable, deliverable_id)
    return row if row is not None and row.tenant_id == tenant_id else None


def _source_health(session: Session, tenant_id: str) -> list[dict[str, Any]]:
    tenant = session.get(models.Tenant, tenant_id)
    metadata = tenant.demo_metadata if tenant and isinstance(tenant.demo_metadata, dict) else {}
    records = metadata.get("sourceHealth")
    return [item for item in records if isinstance(item, dict)][:RESULT_LIMIT] if isinstance(records, list) else []


def _first_score_line(score: models.ScoreSnapshot | None) -> str:
    if score is None:
        return "No persisted score is available for this account; I will not treat that as zero."
    value = "unavailable" if score.score is None else f"{score.score:.0f}"
    status = score.status.replace("_", " ")
    missing = score.result.get("missingInputs") if isinstance(score.result, dict) else []
    missing_text = f" Missing inputs: {', '.join(missing[:3])}." if missing else ""
    return f"{score.score_family}: {value} ({status}).{missing_text}"


def _draft_work_item(account: models.CanonicalAccount | None, signals: list[tuple[models.SignalAccountRelationship, models.IntelligenceSignal]], citations: list[dict[str, Any]]) -> dict[str, Any] | None:
    if account is None:
        return None
    signal = signals[0][1] if signals else None
    return {
        "requires_confirmation": True,
        "create_via": "POST /work-items",
        "payload": {
            "type": "account_action",
            "canonical_account_id": account.id,
            "related_signal_id": signal.id if signal else None,
            "source_signal_ids": [signal.id] if signal else [],
            "supporting_evidence": [{"id": item["record_id"], "dataClassification": item["data_classification"]} for item in citations[:4]],
            "missing_information": ["Owner and due date are intentionally unset unless supplied by the user."],
            "priority": "normal",
            "status": "detected",
            "recommended_action": f"Review {account.display_name or account.legal_name} account context and decide the next outreach step.",
            "approval_state": "not_required",
            "execution_state": "not_started",
        },
    }


def _draft_deliverable(
    account: models.CanonicalAccount | None,
    signals: list[tuple[models.SignalAccountRelationship, models.IntelligenceSignal]],
    scores: list[models.ScoreSnapshot],
    work_items: list[models.WorkItem],
    citations: list[dict[str, Any]],
    source_health: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if account is None:
        return None
    account_name = account.display_name or account.legal_name
    score = scores[0] if scores else None
    freshness = "; ".join([
        "Prepared date not supplied by user",
        *(f"{row.get('displayName')}: {row.get('availability')}" for row in source_health[:3]),
    ])
    sections = [
        {"id": "cover", "heading": "Cover", "blocks": [{"kind": "text", "text": f"Account: {account_name}. Meeting purpose: evidence-backed account discussion. Meeting date: not supplied. Prepared for: BTX leadership and revenue team. Data freshness: {freshness}."}]},
        {"id": "executive-summary", "heading": "Executive Summary", "blocks": [{"kind": "text", "text": f"{account_name} has internal account context and {len(signals)} confirmed account-linked development(s). Recommended posture: review the account and validate the next outreach step. Most important uncertainty: live capacity, customer access, and timing remain unavailable unless cited."}]},
        {"id": "account-context", "heading": "Account Context", "blocks": [{"kind": "text", "text": "; ".join((account.known_programs or [])[:3]) or "No supported program list is available."}]},
        {"id": "recent-developments", "heading": "Recent Developments", "blocks": [{"kind": "text", "text": "\n".join(signal.title for _, signal in signals) or "No confirmed account-linked developments are available."}]},
        {"id": "decision-summary", "heading": "Decision Summary", "blocks": [{"kind": "text", "text": _first_score_line(score)}]},
        {"id": "meeting-preparation", "heading": "Meeting Preparation", "blocks": [{"kind": "text", "text": "Objectives: confirm timing, decision process, qualification requirements, and follow-up owner. Risks to avoid: unsupported capacity claims, invented participants, or treating attractiveness as win probability."}]},
        {"id": "current-work", "heading": "Current Work", "blocks": [{"kind": "text", "text": "\n".join(item.recommended_action for item in work_items[:3]) or "No open work item is available."}]},
        {"id": "sources-and-data-notes", "heading": "Sources And Data Notes", "blocks": [{"kind": "text", "text": "Sources are internal citations returned with this assistant draft. Live internet research, email execution, calendar execution, ERP, and MES integrations are not part of this action."}]},
    ]
    return {
        "requires_confirmation": True,
        "create_via": "POST /deliverables",
        "payload": {
            "type": "meeting_brief",
            "title": f"Executive Account and Meeting Brief - {account_name}",
            "canonical_account_id": account.id,
            "program_id": signals[0][0].signal_id if signals else None,
            "entity_ids": [account.id, *[signal.id for _, signal in signals[:4]]],
            "document": {
                "type": "meeting_brief",
                "title": f"Executive Account and Meeting Brief - {account_name}",
                "brainArea": "accounts",
                "dataClassification": "internal",
                "sections": sections,
                "sources": citations[:8],
                "sourceFreshness": source_health,
                "confidence": "medium" if score is None else "high",
                "actions": [],
            },
        },
    }


def answer(
    session: Session,
    *,
    tenant_id: str,
    message: str,
    context: Any | None = None,
) -> AssistantResult:
    ctx = _context_dict(context)
    tool_activity = [
        "Reviewing account records",
        "Reading score explanation",
        "Checking open work",
        "Reviewing confirmed signals",
    ]
    account = _match_account(session, tenant_id, message, ctx)
    signal = _signal_by_context(session, tenant_id, ctx.get("signal_id"))
    contextual_work = _work_by_context(session, tenant_id, ctx.get("work_item_id"))
    contextual_deliverable = _deliverable_by_context(session, tenant_id, ctx.get("deliverable_id"))
    programs = _programs(session, tenant_id, ctx)
    relationships = _confirmed_relationships(session, tenant_id, account.id) if account else []
    pending_relationships = _pending_relationships(session, tenant_id, account.id) if account else []
    scores = _scores(session, tenant_id, account.id) if account else []
    work_items = _work_items(session, tenant_id, account.id if account else None)
    deliverables = _deliverables(session, tenant_id, account.id if account else None)
    health = _source_health(session, tenant_id)

    citations: list[dict[str, Any]] = []
    related_records: list[dict[str, Any]] = []
    if account:
        citations.append(citation(
            source_type="account",
            record_id=account.id,
            title=account.display_name or account.legal_name,
            claim="Canonical account record used for identity and supported account context.",
            claim_classification="fact",
            data_classification="crm",
        ))
        related_records.append({"type": "account", "id": account.id, "title": account.display_name or account.legal_name, "route": _route("account", account.id)})
    for relationship, item in relationships:
        classification = _source_classification(item.raw_payload, "public")
        citations.append(citation(
            source_type="signal",
            record_id=item.id,
            title=item.title,
            claim="Confirmed relationship-backed account development.",
            claim_classification="fact",
            data_classification=classification,
            relationship_status=relationship.review_status,
            route="/programs" if item.scope == "program" else _route("account", relationship.canonical_account_id),
        ))
        related_records.append({"type": "signal", "id": item.id, "title": item.title, "route": "/programs" if item.scope == "program" else _route("account", relationship.canonical_account_id)})
    for row in scores[:2]:
        citations.append(citation(
            source_type="score",
            record_id=row.id,
            title=f"{row.score_family} score",
            claim="Derived score explanation from persisted score snapshot.",
            claim_classification="derived",
            data_classification="derived",
            route=_route("account", row.entity_id),
        ))
    for item in work_items[:3]:
        citations.append(citation(
            source_type="work_item",
            record_id=item.id,
            title=item.recommended_action,
            claim="Open work item from the normal backend work queue.",
            claim_classification="fact",
            data_classification="operational",
        ))
        related_records.append({"type": "work_item", "id": item.id, "title": item.recommended_action, "route": _route("work_item", item.id)})
    if contextual_work and all(record["id"] != contextual_work.id for record in related_records):
        related_records.append({"type": "work_item", "id": contextual_work.id, "title": contextual_work.recommended_action, "route": _route("work_item", contextual_work.id)})
    if contextual_deliverable:
        related_records.append({"type": "deliverable", "id": contextual_deliverable.id, "title": contextual_deliverable.title, "route": _route("deliverable", contextual_deliverable.id)})
    for item in deliverables[:2]:
        citations.append(citation(
            source_type="deliverable",
            record_id=item.id,
            title=item.title,
            claim="Existing deliverable available in the backend deliverable library.",
            claim_classification="fact",
            data_classification=str((item.document or {}).get("dataClassification") or "internal"),
        ))
    if signal:
        citations.append(citation(
            source_type="signal",
            record_id=signal.id,
            title=signal.title,
            claim="Context signal reviewed with its stored scope preserved.",
            claim_classification="fact" if signal.scope != "market" else "inference",
            data_classification=_source_classification(signal.raw_payload, "public"),
            route="/programs" if signal.scope == "program" else "/ask",
        ))
    for program in programs[:2]:
        record_id = str(program.get("id") or "program")
        citations.append(citation(
            source_type="program",
            record_id=record_id,
            title=str(program.get("name") or record_id),
            claim="Program context from tenant metadata.",
            claim_classification="fact",
            data_classification=str(program.get("dataClassification") or "internal"),
        ))

    name = account.display_name or account.legal_name if account else "the current workspace"
    confirmed_lines = [f"- {item.title}" for _, item in relationships[:4]]
    pending_lines = [f"- {item.title} remains {rel.review_status}; I will not treat it as an account fact." for rel, item in pending_relationships[:3]]
    score_line = _first_score_line(scores[0] if scores else None)
    work_lines = [f"- {item.recommended_action} ({item.status}, {item.priority})" for item in work_items[:4]]
    deliverable_lines = [f"- {item.title}" for item in deliverables[:3]]
    source_lines = [f"- {item.get('displayName')}: {item.get('availability')}" for item in health[:3]]
    content_parts = [
        f"Based on internal records, here is the supported view for {name}.",
        "",
        "What is confirmed:",
        "\n".join(confirmed_lines) if confirmed_lines else "- No confirmed account-linked signal is available.",
        "",
        "Score:",
        f"- {score_line}",
        "",
        "Open work:",
        "\n".join(work_lines) if work_lines else "- No open work item is available.",
    ]
    if pending_lines:
        content_parts.extend(["", "Needs review:", "\n".join(pending_lines)])
    if deliverable_lines:
        content_parts.extend(["", "Existing deliverables:", "\n".join(deliverable_lines)])
    if source_lines:
        content_parts.extend(["", "Source status:", "\n".join(source_lines)])
    content_parts.extend([
        "",
        "Missing information:",
        "- Live capacity and owner/date details are missing unless they appear in a cited internal record.",
        "",
        "Recommended next step:",
        "- Use the highest priority open work item or ask me to prepare a draft for confirmation.",
    ])

    lowered = message.lower()
    action_draft = None
    deliverable_draft = None
    if any(token in lowered for token in ["draft work", "create work", "task", "follow up"]):
        tool_activity.append("Preparing a work-item draft")
        action_draft = _draft_work_item(account, relationships, citations)
    if any(token in lowered for token in ["meeting brief", "executive brief", "account brief", "prepare brief"]):
        tool_activity.append("Preparing a meeting brief")
        deliverable_draft = _draft_deliverable(account, relationships, scores, work_items, citations, health)

    return AssistantResult(
        content="\n".join(content_parts),
        tool_activity=tool_activity,
        citations=citations[:RESULT_LIMIT],
        related_records=related_records[:RESULT_LIMIT],
        action_draft=action_draft,
        deliverable_draft=deliverable_draft,
    )


def persist_turn(
    session: Session,
    *,
    tenant_id: str,
    actor_user_id: str | None,
    message: str,
    conversation_id: str | None = None,
    context: Any | None = None,
) -> tuple[models.AssistantConversation, models.AssistantMessage, models.AssistantMessage]:
    ctx = _context_dict(context)
    conversation = get_conversation(session, tenant_id, conversation_id) if conversation_id else None
    if conversation is None:
        account = _match_account(session, tenant_id, message, ctx)
        conversation = create_conversation(
            session,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            title=_conversation_title(message, account),
            context={**ctx, **({"account_id": account.id} if account and not ctx.get("account_id") else {})},
        )
    elif conversation.status == "archived":
        raise AssistantError("archived_conversation", "Restore this conversation before adding a message.", status_code=409)
    elif ctx:
        apply_context(conversation, ctx)

    user_message = models.AssistantMessage(
        tenant_id=tenant_id,
        conversation_id=conversation.id,
        role="user",
        content=message,
        status="complete",
        tool_activity=[],
        citations=[],
        related_records=[],
        metadata_={},
    )
    session.add(user_message)
    session.flush()

    result = answer(session, tenant_id=tenant_id, message=message, context=conversation.context or ctx)
    assistant_message = models.AssistantMessage(
        tenant_id=tenant_id,
        conversation_id=conversation.id,
        role="assistant",
        content=result.content,
        status="complete",
        tool_activity=result.tool_activity,
        citations=result.citations,
        related_records=result.related_records,
        action_draft=result.action_draft,
        deliverable_draft=result.deliverable_draft,
        metadata_={"orchestration": "internal_retrieval_v1"},
    )
    session.add(assistant_message)
    conversation.updated_at = _now()
    session.flush()
    return conversation, user_message, assistant_message
