from __future__ import annotations

from btx_platform import models
from btx_platform.db import init_db, make_engine, make_session_factory
from btx_platform.intelligence import (
    MINIMUM_RELATIONSHIP_CONFIDENCE,
    account_attractiveness,
    ensure_default_scoring_config,
    is_confirmed_account_signal,
    normalize_identifier,
    resolve_signal_relationships,
    score_account,
    upsert_canonical_accounts,
    validate_weight_config,
)


def _session():
    engine = make_engine("sqlite://")
    init_db(engine)
    return make_session_factory(engine)()


def _account(**overrides):
    record = {
        "id": "hubspot-company-100",
        "hubspot_company_id": "100",
        "name": "Acme Precision Manufacturing Inc.",
        "relationship": "customer",
        "domains": ["acme.example"],
        "aliases": ["Acme Precision"],
        "known_programs": ["precision machining"],
        "known_customers": ["AS9100"],
        **overrides,
    }
    return record


def _signal(**overrides):
    return {
        "id": "monitor-sig-1",
        "event_type": "government_contract_award",
        "entities": ["Acme Precision Manufacturing"],
        "subject_id": "__portfolio__",
        "scope": "market",
        "confidence": 0.91,
        "value": 5_000_000,
        "source_quote": "Acme Precision Manufacturing received a machining award.",
        "detected_at": "2026-07-23T12:00:00Z",
        "artifact": {
            "item_id": "sig-1",
            "headline": "Acme machining award",
            "source_name": "Federal Register",
            "source_date": "2026-07-23T12:00:00Z",
            "run_at": "2026-07-24T12:00:00Z",
            "signal_type": "government_contract_award",
            "relevance_score": 90,
            "analysis_text": "Award evidence.",
            "dollar_figures": [5_000_000],
            "affected_entities": ["Acme Precision Manufacturing"],
            "provenance": {},
        },
        **overrides,
    }


def test_hubspot_and_domain_map_to_one_stable_canonical_account():
    session = _session()
    try:
      first = upsert_canonical_accounts(session, [_account()], "tenant-a")
      second = upsert_canonical_accounts(session, [_account(id="hubspot-company-100", hubspot_company_id="100")], "tenant-a")
      session.commit()

      assert first["hubspot-company-100"] == second["hubspot-company-100"]
      account = session.get(models.CanonicalAccount, first["hubspot-company-100"])
      assert account is not None
      assert account.id.startswith("acct-")
      assert account.hubspot_company_id == "100"
      identifiers = session.query(models.AccountIdentifier).filter(models.AccountIdentifier.canonical_account_id == account.id).all()
      assert {item.identifier_type for item in identifiers} >= {"hubspot_company_id", "domain", "legal_name", "verified_alias"}
    finally:
      session.close()


def test_exact_legal_name_creates_confirmed_relationship_and_score_eligibility():
    session = _session()
    try:
        id_map = upsert_canonical_accounts(session, [_account()], "tenant-a")
        relationships = resolve_signal_relationships(session, tenant_id="tenant-a", signal=_signal())
        session.commit()

        assert len(relationships) == 1
        relationship = relationships[0]
        signal = session.get(models.IntelligenceSignal, "monitor-sig-1")
        assert relationship.canonical_account_id == id_map["hubspot-company-100"]
        assert relationship.match_method == "exact_legal_name"
        assert relationship.review_status == "confirmed"
        assert is_confirmed_account_signal(signal, relationship, MINIMUM_RELATIONSHIP_CONFIDENCE)

        scores = score_account(session, "tenant-a", session.get(models.CanonicalAccount, relationship.canonical_account_id), "test-data-version")
        assert scores["accountAttractiveness"]["status"] == "available"
        assert scores["pursuitPwin"]["status"] == "insufficient_data"
        assert scores["deliveryFeasibility"]["status"] == "insufficient_data"
    finally:
        session.close()


def test_alias_match_requires_review_and_creates_one_work_item():
    session = _session()
    try:
        upsert_canonical_accounts(session, [_account(name="Acme Holdings", aliases=["Acme Precision"])], "tenant-a")
        signal = _signal(entities=["Acme Precision"])
        first = resolve_signal_relationships(session, tenant_id="tenant-a", signal=signal)
        second = resolve_signal_relationships(session, tenant_id="tenant-a", signal=signal)
        session.commit()

        assert first[0].review_status == "needs_review"
        assert second[0].review_status == "needs_review"
        items = session.query(models.WorkItem).filter(models.WorkItem.type == "relationship_review").all()
        assert len(items) == 1
        assert items[0].related_relationship_id == first[0].id
        assert items[0].status == "detected"
    finally:
        session.close()


def test_tenant_identifiers_do_not_cross_resolve():
    session = _session()
    try:
        upsert_canonical_accounts(session, [_account(name="Shared Name LLC", hubspot_company_id="100")], "tenant-a")
        upsert_canonical_accounts(session, [_account(name="Shared Name LLC", hubspot_company_id="200", id="hubspot-company-200")], "tenant-b")
        rels = resolve_signal_relationships(session, tenant_id="tenant-b", signal=_signal(id="monitor-sig-b", entities=["Shared Name"]))
        session.commit()

        assert rels
        assert rels[0].tenant_id == "tenant-b"
        assert session.get(models.CanonicalAccount, rels[0].canonical_account_id).tenant_id == "tenant-b"
    finally:
        session.close()


def test_invalid_weight_config_is_rejected():
    config = {
        "accountAttractiveness": {"a": 0.5},
        "signalConfidence": {"a": 1.0},
        "pursuitPwin": {"a": 1.0},
        "deliveryFeasibility": {"a": 1.0},
        "relationshipHealth": {"a": 1.0},
        "actionPriority": {"a": 1.0},
    }
    try:
        validate_weight_config(config)
    except ValueError as exc:
        assert "accountAttractiveness" in str(exc)
    else:
        raise AssertionError("invalid weight config was accepted")


def test_missing_data_scores_remain_null_and_explain_missing_inputs():
    session = _session()
    try:
        upsert_canonical_accounts(session, [_account(known_programs=[], known_customers=[])], "tenant-a")
        account = session.query(models.CanonicalAccount).one()
        result = account_attractiveness(session, "tenant-a", account, "test-data-version")
        assert result["score"] is None
        assert result["status"] == "insufficient_data"
        assert "Geographic or logistics relevance" in result["missingInputs"]
    finally:
        session.close()


def test_partial_crm_account_with_missing_legal_name_can_be_scored():
    session = _session()
    try:
        account = models.CanonicalAccount(
            id="partial-account",
            tenant_id="tenant-a",
            legal_name=None,
            display_name="Partial CRM account",
            domains=[],
            aliases=[],
            known_programs=[],
            known_customers=[],
        )
        session.add(account)
        session.commit()

        result = account_attractiveness(session, "tenant-a", account, "test-data-version")

        assert result["status"] == "insufficient_data"
        assert result["score"] is None
    finally:
        session.close()


def test_default_scoring_config_weights_sum_to_one():
    session = _session()
    try:
        row = ensure_default_scoring_config(session, "tenant-a", "tester")
        assert row.version
        validate_weight_config(row.document)
    finally:
        session.close()


def test_identifier_normalization_is_deterministic():
    assert normalize_identifier("domain", "https://WWW.Acme.Example/path") == "acme.example"
    assert normalize_identifier("legal_name", "Acme Precision Manufacturing, Inc.") == "acme precision manufacturing"
