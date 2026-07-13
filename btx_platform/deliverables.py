from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from btx_platform import models


DEFAULT_DELIVERABLE_TEMPLATES = [
    ("weekly_memo", "Weekly memo", 10),
    ("meeting_brief", "Meeting brief", 20),
    ("itinerary", "Trip itinerary", 30),
    ("board_deck", "Board deck", 40),
    ("outreach", "Outreach draft", 50),
    ("analysis_annotation", "Analysis annotation", 60),
    ("sales_pitch", "Sales pitch", 70),
    ("capabilities_assessment", "Capabilities assessment", 80),
]


def seed_deliverable_templates(session_factory: sessionmaker, tenant_id: str = models.DEFAULT_TENANT_ID) -> None:
    with session_factory() as session:
        ensure_deliverable_templates(session, tenant_id)
        session.commit()


def ensure_deliverable_templates(session: Session, tenant_id: str) -> None:
    existing = {
        row.agent_id
        for row in session.query(models.DeliverableTemplate)
        .filter(models.DeliverableTemplate.tenant_id == tenant_id)
        .all()
    }
    for agent_id, label, order in DEFAULT_DELIVERABLE_TEMPLATES:
        if agent_id in existing:
            continue
        session.add(models.DeliverableTemplate(
            tenant_id=tenant_id,
            agent_id=agent_id,
            label=label,
            enabled=True,
            order=order,
        ))


def deliverable_response(row: models.Deliverable) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "title": row.title,
        "canonical_account_id": row.canonical_account_id,
        "program_id": row.program_id,
        "trip_id": row.trip_id,
        "document": row.document,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def template_response(row: models.DeliverableTemplate) -> dict:
    return {
        "agent_id": row.agent_id,
        "label": row.label,
        "enabled": row.enabled,
        "order": row.order,
        "prompt_override": row.prompt_override,
        "updated_at": row.updated_at.isoformat(),
    }


def integration_request_response(row: models.IntegrationRequest) -> dict:
    return {
        "id": row.id,
        "requester_name": row.requester_name,
        "integration_name": row.integration_name,
        "notes": row.notes,
        "status": row.status,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
