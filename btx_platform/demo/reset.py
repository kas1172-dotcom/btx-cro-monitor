from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from btx_platform import models
from btx_platform.demo.definitions import DEMO_ACTOR, build_demo_seed
from btx_platform.intelligence import (
    SCORING_CONFIG_VERSION,
    ensure_default_scoring_config,
    normalize_identifier,
    persist_score_snapshot,
    score_account,
    signal_confidence,
)


class DemoResetError(RuntimeError):
    """Raised when a demonstration reset safety check fails."""


@dataclass(frozen=True)
class DemoResetReport:
    tenant_id: str
    dry_run: bool
    verify_only: bool
    accounts: int
    programs: int
    signals: int
    relationships: int
    work_items: int
    deliverables: int
    notes: int
    assistant_conversations: int
    assistant_messages: int
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "dry_run": self.dry_run,
            "verify_only": self.verify_only,
            "accounts": self.accounts,
            "programs": self.programs,
            "signals": self.signals,
            "relationships": self.relationships,
            "work_items": self.work_items,
            "deliverables": self.deliverables,
            "notes": self.notes,
            "assistant_conversations": self.assistant_conversations,
            "assistant_messages": self.assistant_messages,
            "message": self.message,
        }


def _now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def _require_tenant_id(tenant_id: str | None) -> str:
    if not tenant_id or not tenant_id.strip():
        raise DemoResetError("An explicit --tenant value is required.")
    return tenant_id.strip()


def _tenant(session: Session, tenant_id: str) -> models.Tenant:
    row = session.get(models.Tenant, tenant_id)
    if row is None:
        raise DemoResetError(f"Tenant {tenant_id!r} was not found.")
    if not row.is_demonstration:
        raise DemoResetError(f"Tenant {tenant_id!r} is not marked as a demonstration tenant.")
    return row


def _make_report(seed: dict[str, Any], *, dry_run: bool, verify_only: bool, message: str) -> DemoResetReport:
    return DemoResetReport(
        tenant_id=seed["tenant"]["id"],
        dry_run=dry_run,
        verify_only=verify_only,
        accounts=len(seed["accounts"]),
        programs=len(seed["tenant"]["metadata"].get("programs", [])),
        signals=len(seed["signals"]),
        relationships=len(seed["relationships"]),
        work_items=len(seed["work_items"]),
        deliverables=len(seed["deliverables"]),
        notes=len(seed["notes"]),
        assistant_conversations=len(seed.get("assistant_conversations", [])),
        assistant_messages=len(seed.get("assistant_messages", [])),
        message=message,
    )


def create_demo_tenant_marker(session: Session, tenant_id: str, *, display_name: str, metadata: dict[str, Any] | None = None) -> models.Tenant:
    """Create or update only the durable marker row.

    Tests and local setup use this before running the destructive reset. The
    reset itself still refuses to run unless this database marker exists.
    """
    row = session.get(models.Tenant, tenant_id)
    now = _now()
    if row is None:
        row = models.Tenant(
            id=tenant_id,
            display_name=display_name,
            is_demonstration=True,
            demo_reference_date=now,
            demo_metadata=metadata or {},
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    else:
        row.display_name = display_name
        row.is_demonstration = True
        row.demo_reference_date = now
        row.demo_metadata = metadata or row.demo_metadata or {}
        row.updated_at = now
    session.flush()
    return row


def _delete_tenant_rows(session: Session, tenant_id: str) -> None:
    for model in (
        models.AssistantMessage,
        models.AssistantConversation,
        models.HubSpotTaskAudit,
        models.WorkItemNote,
        models.WorkItem,
        models.Deliverable,
        models.ScoreSnapshot,
        models.RelationshipAuditEvent,
        models.SignalAccountRelationship,
        models.IntelligenceSignal,
        models.AccountIdentifier,
        models.CanonicalAccount,
        models.ScoringConfigVersion,
    ):
        session.query(model).filter(model.tenant_id == tenant_id).delete(synchronize_session=False)


def _account_identifier(
    *,
    tenant_id: str,
    account_id: str,
    identifier_type: str,
    value: str,
    classification: str,
    verified: bool,
) -> models.AccountIdentifier:
    digest = hashlib.sha256(f"{tenant_id}:{account_id}:{identifier_type}:{value}".encode("utf-8")).hexdigest()[:24]
    return models.AccountIdentifier(
        id=f"demoid{digest}"[:32],
        tenant_id=tenant_id,
        canonical_account_id=account_id,
        identifier_type=identifier_type,
        normalized_value=normalize_identifier(identifier_type, value),
        original_value=value,
        source_classification=classification,
        verified=verified,
    )


def _seed_accounts(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    seen_identifiers: set[tuple[str, str]] = set()

    def add_identifier(*, account_id: str, identifier_type: str, value: str, classification: str, verified: bool) -> None:
        normalized = normalize_identifier(identifier_type, value)
        key = (identifier_type, normalized)
        if not normalized or key in seen_identifiers:
            return
        seen_identifiers.add(key)
        session.add(_account_identifier(
            tenant_id=tenant_id,
            account_id=account_id,
            identifier_type=identifier_type,
            value=value,
            classification=classification,
            verified=verified,
        ))

    accounts_by_id: dict[str, models.CanonicalAccount] = {}
    for record in seed["accounts"]:
        row = models.CanonicalAccount(
            id=record["id"],
            tenant_id=tenant_id,
            legal_name=record["name"],
            display_name=record["name"],
            domain=record["domains"][0] if record.get("domains") else None,
            account_type="customer" if record["relationship"] == "customer" else "prospect",
            hubspot_company_id=record.get("hubspot_company_id") or f"demo-hubspot-{record['id']}",
            domains=record.get("domains", []),
            aliases=record.get("aliases", []),
            known_programs=record.get("known_programs", []),
            known_customers=record.get("known_customers", []),
            cage_code=record.get("cage_code"),
            uei=record.get("uei"),
            needs=record.get("needs", []),
        )
        session.add(row)
        accounts_by_id[row.id] = row
    # Identifiers carry a foreign key to canonical_accounts. Postgres enforces it
    # on flush, and there is no ORM relationship telling the unit of work to
    # order the inserts, so the accounts are flushed first. SQLite does not
    # enforce foreign keys by default, which is why this only failed on deploy.
    session.flush()

    for record in seed["accounts"]:
        row = accounts_by_id[record["id"]]
        add_identifier(account_id=row.id, identifier_type="legal_name", value=record["name"], classification="crm", verified=True)
        add_identifier(account_id=row.id, identifier_type="hubspot_company_id", value=row.hubspot_company_id or row.id, classification="crm" if record.get("hubspot_company_id") else "simulated", verified=True)
        for domain in record.get("domains", []):
            add_identifier(account_id=row.id, identifier_type="domain", value=domain, classification="public", verified=True)
        for alias in record.get("aliases", []):
            add_identifier(account_id=row.id, identifier_type="verified_alias", value=alias, classification="public", verified=False)
        if record.get("cage_code"):
            add_identifier(account_id=row.id, identifier_type="cage_code", value=record["cage_code"], classification="public", verified=True)
        if record.get("uei"):
            add_identifier(account_id=row.id, identifier_type="uei", value=record["uei"], classification="public", verified=True)


def _seed_signals(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    for signal in seed["signals"]:
        row = models.IntelligenceSignal(
            id=signal["id"],
            tenant_id=tenant_id,
            title=signal["artifact"]["headline"],
            summary=signal["source_quote"],
            analysis=signal["artifact"]["analysis_text"],
            scope=signal.get("scope", "market"),
            event_type=signal["event_type"],
            event_type_status="classified",
            occurred_at=datetime.fromisoformat(signal["detected_at"].replace("Z", "+00:00")),
            published_at=datetime.fromisoformat(signal["detected_at"].replace("Z", "+00:00")),
            retrieved_at=datetime.fromisoformat(signal["detected_at"].replace("Z", "+00:00")),
            source_ids=[signal["artifact"]["source_name"]],
            evidence_ids=[signal["id"]],
            extraction_confidence=signal["confidence"],
            raw_payload=signal,
        )
        session.add(row)


def _seed_relationships(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    for item in seed["relationships"]:
        row = models.SignalAccountRelationship(
            id=item["id"],
            tenant_id=tenant_id,
            signal_id=item["signal_id"],
            canonical_account_id=item["canonical_account_id"],
            source_entity_name=item["source_entity_name"],
            match_method=item["match_method"],
            confidence=item["confidence"],
            review_status=item["review_status"],
            creation_source=item["creation_source"],
            evidence_ids=item["evidence_ids"],
            confirmed_by_user_id=item.get("confirmed_by_user_id"),
            confirmed_at=item.get("confirmed_at"),
            last_validated_at=item.get("confirmed_at") or _now(),
        )
        session.add(row)
        # The audit event points at the relationship, so the relationship has to
        # exist before it is written.
        session.flush()
        session.add(models.RelationshipAuditEvent(
            id=f"aud{item['id']}"[:32],
            tenant_id=tenant_id,
            relationship_id=row.id,
            action="seed_confirmed" if row.review_status == "confirmed" else "seed_needs_review",
            actor_user_id=DEMO_ACTOR,
            note="Demonstration reset restored relationship state.",
            after={
                "review_status": row.review_status,
                "dataClassification": "public" if row.creation_source == "public_data" else "derived",
            },
        ))


def _audit(action: str, at: datetime, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "action": action,
        "actor": DEMO_ACTOR,
        "timestamp": at.isoformat().replace("+00:00", "Z"),
        "dataClassification": "simulated",
        **(extra or {}),
    }


def _seed_work(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    now = _now()
    for item in seed["work_items"]:
        row = models.WorkItem(
            id=item["id"],
            tenant_id=tenant_id,
            type=item["type"],
            canonical_account_id=item.get("canonical_account_id"),
            related_signal_id=item.get("related_signal_id"),
            related_relationship_id=item.get("related_relationship_id"),
            program_id=item.get("program_id"),
            score_snapshot_ids=[],
            source_signal_ids=item.get("source_signal_ids", []),
            supporting_evidence=item.get("supporting_evidence", []),
            missing_information=item.get("missing_information", []),
            dedupe_key=item.get("dedupe_key"),
            owner=item.get("owner"),
            priority=item.get("priority", "normal"),
            priority_status="available",
            status=item.get("status", "detected"),
            due_date=item.get("due_date"),
            description=item.get("description"),
            recommended_action=item["recommended_action"],
            generated_artifact_ref=item.get("generated_artifact_ref"),
            approval_state=item.get("approval_state", "not_required"),
            execution_state=item.get("execution_state", "not_started"),
            outcome=item.get("outcome"),
            outcome_category=item.get("outcome_category"),
            follow_up_date=item.get("follow_up_date"),
            external_system=item.get("external_system"),
            external_record_id=item.get("external_record_id"),
            external_record_url=item.get("external_record_url"),
            execution_idempotency_key=item.get("execution_idempotency_key"),
            audit_history=[
                _audit("demo_seed_restored", now, {"status": item.get("status"), "approval_state": item.get("approval_state")})
            ],
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    for note in seed["notes"]:
        session.add(models.WorkItemNote(
            id=note["id"],
            tenant_id=tenant_id,
            work_item_id=note["work_item_id"],
            author_user_id=note["author_user_id"],
            body=note["body"],
            note_type=note["note_type"],
            evidence_ids=note.get("evidence_ids", []),
            created_at=note["created_at"],
        ))


def _seed_deliverables(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    now = _now()
    for item in seed["deliverables"]:
        session.add(models.Deliverable(
            id=item["id"],
            tenant_id=tenant_id,
            type=item["type"],
            title=item["title"],
            canonical_account_id=item.get("canonical_account_id"),
            program_id=item.get("program_id"),
            trip_id=None,
            entity_ids=item.get("entity_ids", []),
            document=item["document"],
            created_at=now,
            updated_at=now,
        ))


def _seed_assistant(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    for item in seed.get("assistant_conversations", []):
        session.add(models.AssistantConversation(
            id=item["id"],
            tenant_id=tenant_id,
            title=item["title"],
            status=item["status"],
            created_by_user_id=item.get("created_by_user_id"),
            context=item.get("context"),
            related_account_id=item.get("related_account_id"),
            related_program_id=item.get("related_program_id"),
            related_work_item_id=item.get("related_work_item_id"),
            related_signal_id=item.get("related_signal_id"),
            related_deliverable_id=item.get("related_deliverable_id"),
            archived_at=item.get("archived_at"),
            created_at=item["created_at"],
            updated_at=item["updated_at"],
        ))
    for item in seed.get("assistant_messages", []):
        session.add(models.AssistantMessage(
            id=item["id"],
            tenant_id=tenant_id,
            conversation_id=item["conversation_id"],
            role=item["role"],
            content=item["content"],
            status=item["status"],
            tool_activity=item.get("tool_activity", []),
            citations=item.get("citations", []),
            related_records=item.get("related_records", []),
            action_draft=item.get("action_draft"),
            deliverable_draft=item.get("deliverable_draft"),
            metadata_=item.get("metadata", {}),
            created_at=item["created_at"],
        ))


def _seed_scores(session: Session, seed: dict[str, Any], tenant_id: str) -> None:
    ensure_default_scoring_config(session, tenant_id, DEMO_ACTOR)
    source_data_version = f"{tenant_id}:demo-reset:{seed['tenant']['reference_date'].date().isoformat()}"
    accounts = session.query(models.CanonicalAccount).filter(models.CanonicalAccount.tenant_id == tenant_id).all()
    relationships = session.query(models.SignalAccountRelationship).filter(models.SignalAccountRelationship.tenant_id == tenant_id).all()
    relationship_by_signal: dict[str, list[models.SignalAccountRelationship]] = {}
    for relationship in relationships:
        relationship_by_signal.setdefault(relationship.signal_id, []).append(relationship)
    for account in accounts:
        for family, result in score_account(session, tenant_id, account, source_data_version).items():
            snapshot = persist_score_snapshot(session, tenant_id, entity_type="account", entity_id=account.id, score_family=family, result=result)
            snapshot.id = f"score-{account.id[-8:]}-{family[:8]}"[:32]
    signals = session.query(models.IntelligenceSignal).filter(models.IntelligenceSignal.tenant_id == tenant_id).all()
    for signal in signals:
        result = signal_confidence(signal, relationship_by_signal.get(signal.id, []), source_data_version)
        snapshot = persist_score_snapshot(session, tenant_id, entity_type="signal", entity_id=signal.id, score_family="signalConfidence", result=result)
        snapshot.id = f"score-{signal.id[-10:]}-signal"[:32]


def _store_tenant_metadata(session: Session, tenant: models.Tenant, seed: dict[str, Any]) -> None:
    account_overrides = {
        record["id"]: {
            "location": {"city": record.get("city", ""), "state": record.get("state"), "lat": None, "lon": None},
            "needs": record.get("needs", []),
            "dataClassification": "simulated" if record["relationship"] == "customer" else "public",
        }
        for record in seed["accounts"]
    }
    tenant.display_name = seed["tenant"]["display_name"]
    tenant.is_demonstration = True
    tenant.demo_reference_date = seed["tenant"]["reference_date"]
    tenant.demo_metadata = {**seed["tenant"]["metadata"], "accountOverrides": account_overrides}
    tenant.updated_at = _now()
    session.add(tenant)


def reset_demo_tenant(
    session_factory: sessionmaker[Session],
    tenant_id: str | None,
    *,
    dry_run: bool = False,
    verify_only: bool = False,
    fail_stage: str | None = None,
) -> DemoResetReport:
    tenant_id = _require_tenant_id(tenant_id)
    seed = build_demo_seed()

    with session_factory() as session:
        tenant = _tenant(session, tenant_id)
        if tenant_id != seed["tenant"]["id"]:
            raise DemoResetError(f"Tenant {tenant_id!r} is not the configured demonstration tenant {seed['tenant']['id']!r}.")
        if verify_only:
            verify_demo_tenant(session, tenant_id)
            return _make_report(seed, dry_run=False, verify_only=True, message="Verification passed.")
        if dry_run:
            return _make_report(seed, dry_run=True, verify_only=False, message="Dry run passed; no rows were changed.")
        try:
            _delete_tenant_rows(session, tenant_id)
            if fail_stage == "after_delete":
                raise DemoResetError("Injected failure after delete.")
            _store_tenant_metadata(session, tenant, seed)
            # Each stage references rows written by the stage before it, and
            # Postgres enforces those foreign keys on flush. Flushing between
            # stages keeps the insert order correct.
            for seed_stage in (
                _seed_accounts,
                _seed_signals,
                _seed_relationships,
                _seed_scores,
                _seed_work,
                _seed_deliverables,
                _seed_assistant,
            ):
                seed_stage(session, seed, tenant_id)
                session.flush()
            if fail_stage == "before_commit":
                raise DemoResetError("Injected failure before commit.")
            verify_demo_tenant(session, tenant_id)
            session.commit()
        except Exception:
            session.rollback()
            raise
    return _make_report(seed, dry_run=False, verify_only=False, message="Demo tenant reset and verification passed.")


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise DemoResetError(message)


def verify_demo_tenant(session: Session, tenant_id: str | None) -> None:
    tenant_id = _require_tenant_id(tenant_id)
    seed = build_demo_seed()
    tenant = _tenant(session, tenant_id)
    _assert(tenant.id == seed["tenant"]["id"], "Unexpected tenant id.")
    _assert(tenant.is_demonstration, "Tenant marker is not demonstration.")

    accounts = session.query(models.CanonicalAccount).filter(models.CanonicalAccount.tenant_id == tenant_id).all()
    signals = session.query(models.IntelligenceSignal).filter(models.IntelligenceSignal.tenant_id == tenant_id).all()
    relationships = session.query(models.SignalAccountRelationship).filter(models.SignalAccountRelationship.tenant_id == tenant_id).all()
    work_items = session.query(models.WorkItem).filter(models.WorkItem.tenant_id == tenant_id).all()
    deliverables = session.query(models.Deliverable).filter(models.Deliverable.tenant_id == tenant_id).all()
    notes = session.query(models.WorkItemNote).filter(models.WorkItemNote.tenant_id == tenant_id).all()
    assistant_conversations = session.query(models.AssistantConversation).filter(models.AssistantConversation.tenant_id == tenant_id).all()
    assistant_messages = session.query(models.AssistantMessage).filter(models.AssistantMessage.tenant_id == tenant_id).all()
    snapshots = session.query(models.ScoreSnapshot).filter(models.ScoreSnapshot.tenant_id == tenant_id).all()

    _assert(len(accounts) == len(seed["accounts"]), "Expected demo account count was not restored.")
    _assert(len(signals) == len(seed["signals"]), "Expected demo signal count was not restored.")
    _assert(len(relationships) == len(seed["relationships"]), "Expected relationship count was not restored.")
    _assert(len(work_items) == len(seed["work_items"]), "Expected work-item count was not restored.")
    _assert(len(deliverables) == len(seed["deliverables"]), "Expected deliverable count was not restored.")
    _assert(len(notes) == len(seed["notes"]), "Expected work-item note count was not restored.")
    _assert(len(assistant_conversations) == len(seed["assistant_conversations"]), "Expected assistant conversation count was not restored.")
    _assert(len(assistant_messages) == len(seed["assistant_messages"]), "Expected assistant message count was not restored.")
    _assert({row.tenant_id for row in [*accounts, *signals, *relationships, *work_items, *deliverables, *notes, *assistant_conversations, *assistant_messages, *snapshots]} == {tenant_id}, "Tenant isolation check failed.")

    by_status = {row.id: row for row in work_items}
    _assert(any(row.review_status == "confirmed" for row in relationships), "No confirmed relationship exists.")
    _assert(any(row.review_status == "needs_review" for row in relationships), "No unresolved relationship review exists.")
    _assert(any(row.scope == "specific_account" for row in signals), "No account-linked signal exists.")
    _assert(any(row.scope == "market" for row in signals), "No market-level signal exists.")
    # The demo is exactly two journeys: Lockheed as a current customer, nLIGHT as a prospect.
    account_types = {row.id: row.account_type for row in accounts}
    _assert(account_types.get("demo-acct-lockheed") == "customer", "Lockheed customer journey is missing.")
    _assert(account_types.get("demo-acct-nlight") == "prospect", "nLIGHT prospect journey is missing.")
    nlight_research = by_status.get("demo-wi-research-nlight")
    _assert(nlight_research is not None, "nLIGHT prospect-research work item is missing.")
    _assert(len(nlight_research.missing_information or []) >= 4, "nLIGHT prospect research must name its missing evidence.")
    nlight_account = next((row for row in accounts if row.id == "demo-acct-nlight"), None)
    _assert(not (nlight_account.cage_code if nlight_account else None), "nLIGHT must not carry an invented CAGE code.")
    # The demo's whole scoring claim is that a score is earned from evidence.
    # Lockheed must score; the unqualified prospect must not.
    attractiveness = {
        row.entity_id: row
        for row in snapshots
        if row.score_family == "accountAttractiveness" and row.entity_type == "account"
    }
    lockheed_score = attractiveness.get("demo-acct-lockheed")
    _assert(lockheed_score is not None, "Lockheed attractiveness snapshot is missing.")
    _assert(lockheed_score.status == "available", "Lockheed must produce an engine-computed attractiveness score.")
    _assert(isinstance(lockheed_score.result.get("score"), (int, float)), "Lockheed score value was not computed.")
    _assert(
        len([f for f in lockheed_score.result.get("positiveFactors", []) if f.get("contribution") is not None]) >= 4,
        "Lockheed score must show a populated factor breakdown.",
    )
    # Each demo account must resolve to its real HubSpot company. A numeric id is
    # a real portal record; the "demo-hubspot-" prefix is the simulated fallback.
    expected_hubspot_ids = {
        "demo-acct-lockheed": "336059557613",
        "demo-acct-nlight": "336368378559",
        "demo-acct-pulse-space": "336368378560",
    }
    for account in accounts:
        expected = expected_hubspot_ids.get(account.id)
        if expected is None:
            continue
        _assert(
            account.hubspot_company_id == expected,
            f"{account.id} must bind to real HubSpot company {expected}, found {account.hubspot_company_id!r}.",
        )
    # The prospects are deliberately bare. That absence is the demo's argument,
    # so it is asserted rather than left to drift.
    for prospect_id in ("demo-acct-nlight", "demo-acct-pulse-space"):
        prospect = next((row for row in accounts if row.id == prospect_id), None)
        _assert(prospect is not None, f"{prospect_id} is missing.")
        _assert(not prospect.cage_code, f"{prospect_id} must carry no CAGE code.")
        _assert(prospect.account_type == "prospect", f"{prospect_id} must stay classified as a prospect.")
    contacts = (tenant.demo_metadata or {}).get("contacts", [])
    opportunities = (tenant.demo_metadata or {}).get("opportunities", [])
    _assert(
        not any(item.get("company_id") == "demo-acct-pulse-space" for item in contacts),
        "demo-acct-pulse-space must carry no contact.",
    )
    # nLIGHT carries a placeholder row whose whole job is to name the gap. It must
    # never become a person, because an invented contact would erase the argument
    # the prospect journey exists to make.
    for item in contacts:
        if item.get("company_id") != "demo-acct-nlight":
            continue
        _assert(
            item.get("name") == "Contact not provided",
            "nLIGHT must not carry a named contact; only the not-provided placeholder.",
        )
    for prospect_id in ("demo-acct-nlight", "demo-acct-pulse-space"):
        _assert(
            not any(item.get("company_id") == prospect_id for item in opportunities),
            f"{prospect_id} must carry no deal.",
        )

    nlight_score = attractiveness.get("demo-acct-nlight")
    _assert(nlight_score is not None, "nLIGHT attractiveness snapshot is missing.")
    _assert(nlight_score.status == "insufficient_data", "nLIGHT must stay honestly unscored.")
    _assert(nlight_score.result.get("score") is None, "nLIGHT must not carry a score value.")
    _assert(by_status["demo-wi-approve-lockheed"].approval_state == "pending", "Awaiting-approval item was not restored.")
    _assert(by_status["demo-wi-approved-pulse"].approval_state == "approved", "Approved item was not restored.")
    _assert(by_status["demo-wi-verified-sim"].execution_state == "verified", "Verified simulated action was not restored.")
    _assert(by_status["demo-wi-verified-sim"].external_system == "hubspot-demo", "Simulated verification classification is missing.")
    _assert(by_status["demo-wi-closed-outcome"].outcome_category == "learning", "Completed outcome was not restored.")
    deliverable_by_id = {row.id: row for row in deliverables}
    executive_brief = deliverable_by_id.get("demo-deliv-lockheed-brief")
    _assert(executive_brief is not None, "Seeded executive brief was not restored.")
    _assert(executive_brief.title == "Executive Account and Meeting Brief - Lockheed Martin Corporation", "Seeded executive brief title is incorrect.")
    headings = {section.get("heading") for section in (executive_brief.document or {}).get("sections", [])}
    _assert({"Cover", "Executive Summary", "Decision Summary", "Sources And Data Notes"} <= headings, "Seeded executive brief is missing required sections.")
    _assert(all(row.raw_payload.get("dataClassification") == "public" for row in signals), "Public source records lost classification.")
    _assert(all(row.raw_payload.get("source_url") for row in signals), "Public source metadata is incomplete.")
    _assert(all(row.result["sourceDataVersion"].startswith(f"{tenant_id}:demo-reset:") for row in snapshots), "Score snapshots do not reference demo source data.")
    _assert(any(row.status == "archived" for row in assistant_conversations), "No archived assistant conversation exists.")
    _assert(any(row.related_account_id == "demo-acct-lockheed" for row in assistant_conversations), "No seeded account conversation exists.")
    _assert(all("reasoning" not in (row.metadata_ or {}) for row in assistant_messages), "Assistant messages must not store hidden reasoning.")
    _assert(any((row.citations or []) for row in assistant_messages if row.role == "assistant"), "Seeded assistant response has no citations.")

    active = [row for row in work_items if row.status not in {"closed", "dismissed"}]
    dedupe = [row.dedupe_key for row in active if row.dedupe_key]
    _assert(len(dedupe) == len(set(dedupe)), "Duplicate active work-item dedupe keys exist.")
    review_items = [row for row in active if row.type == "relationship_review"]
    _assert(len(review_items) == 1, "Duplicate active relationship-review items exist.")
