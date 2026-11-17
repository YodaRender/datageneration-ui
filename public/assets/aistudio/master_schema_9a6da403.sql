-- 001 · Schemas and enum types
-- Layer separation (spec 2.5): core = raw events + state, analytics = features,
-- labels = ground truth, quality = validation + run metadata,
-- model_input = the ONLY schema a model may read (views, label-free).
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS labels;
CREATE SCHEMA IF NOT EXISTS quality;
CREATE SCHEMA IF NOT EXISTS model_input;

CREATE TYPE core.side_t             AS ENUM ('BUY', 'SELL');
CREATE TYPE core.event_type_t       AS ENUM ('NEW', 'AMEND', 'CANCEL', 'PARTIAL_FILL', 'FILL', 'REJECT');
CREATE TYPE core.order_type_t       AS ENUM ('LIMIT', 'MARKET');
CREATE TYPE core.tif_t              AS ENUM ('DAY', 'IOC', 'GTC');
CREATE TYPE core.order_status_t     AS ENUM ('NEW', 'ACTIVE', 'PARTIALLY_FILLED', 'CANCELLED', 'FILLED', 'REJECTED');
CREATE TYPE core.reason_code_t      AS ENUM (
    'SELF_MATCH_PREVENTION', 'REPLACED', 'IOC_REMAINDER', 'MARKET_REMAINDER',
    'TOO_LATE_TO_CANCEL', 'TOO_LATE_TO_AMEND',
    'INVALID_TICK', 'INVALID_LOT', 'OUTSIDE_PRICE_BAND', 'INVALID_QUANTITY', 'INVALID_AMEND_QTY'
);
CREATE TYPE core.data_quality_flag_t AS ENUM ('NORMAL', 'DUPLICATE', 'MISSING', 'OUT_OF_ORDER', 'INCONSISTENT');
CREATE TYPE core.aggressor_t        AS ENUM ('BUY', 'SELL', 'UNKNOWN');
CREATE TYPE core.execution_status_t AS ENUM ('EXECUTED', 'CORRECTED', 'CANCELLED');
CREATE TYPE core.book_status_t      AS ENUM ('VALID', 'CROSSED', 'LOCKED', 'EMPTY_BID', 'EMPTY_ASK', 'EMPTY');
CREATE TYPE core.instrument_type_t  AS ENUM ('EQUITY', 'FUTURE', 'OPTION', 'OTHER');
CREATE TYPE core.regime_t           AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE analytics.entity_type_t   AS ENUM ('ORDER', 'ACCOUNT', 'PARTICIPANT', 'INSTRUMENT', 'SCENARIO');
CREATE TYPE analytics.scoring_stage_t AS ENUM ('SUBMISSION', 'IN_LIFECYCLE', 'POST_EVENT');

CREATE TYPE labels.ground_truth_label_t AS ENUM (
    'LARGE_ORDER_ONLY', 'LAYERING_PATTERN', 'SPOOFING_LIKE_SEQUENCE',
    'LEGITIMATE_LARGE_ORDER', 'LEGITIMATE_MULTI_LEVEL_QUOTING',
    'CANCEL_WITHOUT_OPPOSITE_TRADE', 'COINCIDENTAL_OPPOSITE_TRADE'
);
CREATE TYPE labels.evaluation_label_t   AS ENUM ('POSITIVE_TEST', 'NEGATIVE_CONTROL');
CREATE TYPE labels.event_association_t  AS ENUM ('LINKED', 'COINCIDENTAL', 'INDEPENDENT', 'NOT_APPLICABLE');

CREATE TYPE quality.validation_status_t AS ENUM ('PASS', 'FAIL', 'PENDING');

-- 002 · Run metadata
-- REQ-OPS04 / REQ-OPS09: seed, versions and the full configuration travel with every dataset.
CREATE TABLE quality.run_metadata (
    run_id             TEXT PRIMARY KEY,
    random_seed        BIGINT      NOT NULL,
    config_version     TEXT        NOT NULL,
    generator_version  TEXT        NOT NULL,
    scenario_version   TEXT        NOT NULL,
    config_hash        TEXT        NOT NULL,
    config_json        JSONB       NOT NULL,   -- includes every threshold value used
    status             TEXT        NOT NULL DEFAULT 'GENERATING'
                       CHECK (status IN ('GENERATING', 'VALIDATED', 'FAILED', 'EXPORTED')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 003 · Instrument master
-- Spec 3.2
CREATE TABLE core.instrument_master (
    run_id            TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    instrument_id     TEXT NOT NULL,
    symbol            TEXT NOT NULL,
    exchange          TEXT NOT NULL,
    currency          TEXT NOT NULL,
    tick_size         NUMERIC(18, 6) NOT NULL CHECK (tick_size > 0),
    lot_size          INTEGER        NOT NULL CHECK (lot_size > 0),
    price_band_low    NUMERIC(18, 6) NOT NULL,
    price_band_high   NUMERIC(18, 6) NOT NULL,
    session_open      TIMESTAMPTZ    NOT NULL,
    session_close     TIMESTAMPTZ    NOT NULL,
    instrument_type   core.instrument_type_t NOT NULL,
    reference_price   NUMERIC(18, 6) NOT NULL,
    volatility_regime core.regime_t  NOT NULL,
    liquidity_regime  core.regime_t  NOT NULL,
    PRIMARY KEY (run_id, instrument_id),
    CHECK (price_band_low < price_band_high),
    CHECK (reference_price BETWEEN price_band_low AND price_band_high),
    CHECK (session_open < session_close)
);

-- 004 · Order state
-- Spec 3.5. State is derived from the event stream; it is never written independently.
CREATE TABLE core.order_state (
    run_id                   TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    order_id                 TEXT NOT NULL,
    instrument_id            TEXT NOT NULL,
    participant_id           TEXT NOT NULL,
    account_id               TEXT NOT NULL,
    side                     core.side_t NOT NULL,
    order_type               core.order_type_t NOT NULL,
    time_in_force            core.tif_t NOT NULL,
    parent_order_id          TEXT,
    limit_price              NUMERIC(18, 6),
    original_qty             BIGINT NOT NULL CHECK (original_qty >= 0),
    amended_qty_delta        BIGINT NOT NULL DEFAULT 0,
    filled_qty               BIGINT NOT NULL DEFAULT 0 CHECK (filled_qty >= 0),
    cancelled_qty            BIGINT NOT NULL DEFAULT 0 CHECK (cancelled_qty >= 0),
    remaining_qty            BIGINT NOT NULL CHECK (remaining_qty >= 0),
    creation_timestamp       TIMESTAMPTZ NOT NULL,
    last_update_timestamp    TIMESTAMPTZ NOT NULL,
    status                   core.order_status_t NOT NULL,
    queue_priority_timestamp TIMESTAMPTZ NOT NULL,
    scenario_id              TEXT,
    PRIMARY KEY (run_id, order_id),
    FOREIGN KEY (run_id, instrument_id) REFERENCES core.instrument_master (run_id, instrument_id),
    FOREIGN KEY (run_id, parent_order_id) REFERENCES core.order_state (run_id, order_id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT order_qty_identity CHECK (
        status = 'REJECTED'
        OR original_qty + amended_qty_delta = filled_qty + cancelled_qty + remaining_qty
    ),
    CHECK (status <> 'FILLED' OR remaining_qty = 0),
    CHECK (status <> 'CANCELLED' OR remaining_qty = 0),
    CHECK (status <> 'REJECTED' OR (remaining_qty = 0 AND filled_qty = 0 AND cancelled_qty = 0))
);
CREATE INDEX order_state_instrument_status_idx ON core.order_state (run_id, instrument_id, status);
CREATE INDEX order_state_participant_idx       ON core.order_state (run_id, participant_id);

-- 005 · Order events
-- Spec 3.3. One row per event affecting one order.
-- scenario_id deliberately has no FK to labels.* (REQ-OPS07).
CREATE TABLE core.order_events (
    run_id                TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    event_id              TEXT NOT NULL,
    scenario_id           TEXT,
    instrument_id         TEXT NOT NULL,
    venue_id              TEXT NOT NULL,
    event_timestamp       TIMESTAMPTZ NOT NULL,
    sequence_number       BIGINT NOT NULL CHECK (sequence_number > 0),
    order_id              TEXT NOT NULL,
    parent_order_id       TEXT,
    participant_id        TEXT NOT NULL,
    account_id            TEXT NOT NULL,
    side                  core.side_t NOT NULL,
    event_type            core.event_type_t NOT NULL,
    price                 NUMERIC(18, 6) CHECK (price IS NULL OR price > 0),
    order_qty             BIGINT NOT NULL CHECK (order_qty >= 0),
    event_qty             BIGINT NOT NULL CHECK (event_qty >= 0),
    remaining_qty         BIGINT NOT NULL CHECK (remaining_qty >= 0),
    order_type            core.order_type_t NOT NULL,
    time_in_force         core.tif_t NOT NULL,
    source_sequence       BIGINT NOT NULL,
    exchange_order_status core.order_status_t NOT NULL,
    is_scenario_event     BOOLEAN NOT NULL DEFAULT FALSE,
    data_quality_flag     core.data_quality_flag_t NOT NULL DEFAULT 'NORMAL',
    reason_code           core.reason_code_t,
    trade_id              TEXT,
    is_engine_generated   BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (run_id, event_id),
    UNIQUE (run_id, sequence_number),
    FOREIGN KEY (run_id, instrument_id) REFERENCES core.instrument_master (run_id, instrument_id),
    FOREIGN KEY (run_id, order_id) REFERENCES core.order_state (run_id, order_id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (run_id, parent_order_id) REFERENCES core.order_state (run_id, order_id)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK (remaining_qty <= order_qty),
    CHECK ((event_type IN ('FILL', 'PARTIAL_FILL')) = (trade_id IS NOT NULL))
);
CREATE INDEX order_events_order_idx      ON core.order_events (run_id, order_id, sequence_number);
CREATE INDEX order_events_instrument_idx ON core.order_events (run_id, instrument_id, sequence_number);
CREATE INDEX order_events_scenario_idx   ON core.order_events (run_id, scenario_id) WHERE scenario_id IS NOT NULL;
CREATE INDEX order_events_time_idx       ON core.order_events (run_id, event_timestamp);

-- 006 · Trades
-- Spec 3.6. A cancellation is not a trade; only real executions land here.
CREATE TABLE core.trades (
    run_id              TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    trade_id            TEXT NOT NULL,
    instrument_id       TEXT NOT NULL,
    trade_timestamp     TIMESTAMPTZ NOT NULL,
    price               NUMERIC(18, 6) NOT NULL CHECK (price > 0),
    quantity            BIGINT NOT NULL CHECK (quantity > 0),
    buy_order_id        TEXT NOT NULL,
    sell_order_id       TEXT NOT NULL,
    buy_participant_id  TEXT NOT NULL,
    sell_participant_id TEXT NOT NULL,
    aggressor_side      core.aggressor_t NOT NULL,
    scenario_id         TEXT,
    execution_status    core.execution_status_t NOT NULL DEFAULT 'EXECUTED',
    PRIMARY KEY (run_id, trade_id),
    FOREIGN KEY (run_id, instrument_id) REFERENCES core.instrument_master (run_id, instrument_id),
    FOREIGN KEY (run_id, buy_order_id)  REFERENCES core.order_state (run_id, order_id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (run_id, sell_order_id) REFERENCES core.order_state (run_id, order_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (buy_order_id <> sell_order_id)
);
CREATE INDEX trades_instrument_time_idx ON core.trades (run_id, instrument_id, trade_timestamp);

-- 007 · Book snapshots
-- Spec 3.7. Snapshots are derived from the event stream, never generated independently.
CREATE TABLE core.book_snapshots (
    run_id             TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    snapshot_id        TEXT NOT NULL,
    instrument_id      TEXT NOT NULL,
    snapshot_timestamp TIMESTAMPTZ NOT NULL,
    sequence_number    BIGINT NOT NULL,
    best_bid_price     NUMERIC(18, 6),
    best_bid_qty       BIGINT,
    best_ask_price     NUMERIC(18, 6),
    best_ask_qty       BIGINT,
    spread             NUMERIC(18, 6),
    mid_price          NUMERIC(18, 6),
    bid_prices         NUMERIC(18, 6)[] NOT NULL DEFAULT '{}',
    bid_depths         BIGINT[]         NOT NULL DEFAULT '{}',
    bid_order_counts   INTEGER[]        NOT NULL DEFAULT '{}',
    ask_prices         NUMERIC(18, 6)[] NOT NULL DEFAULT '{}',
    ask_depths         BIGINT[]         NOT NULL DEFAULT '{}',
    ask_order_counts   INTEGER[]        NOT NULL DEFAULT '{}',
    bid_total_depth    BIGINT NOT NULL DEFAULT 0,
    ask_total_depth    BIGINT NOT NULL DEFAULT 0,
    book_status        core.book_status_t NOT NULL,
    data_quality_flag  core.data_quality_flag_t NOT NULL DEFAULT 'NORMAL',
    PRIMARY KEY (run_id, snapshot_id),
    FOREIGN KEY (run_id, instrument_id) REFERENCES core.instrument_master (run_id, instrument_id),
    CHECK (cardinality(bid_prices) = cardinality(bid_depths)
       AND cardinality(bid_prices) = cardinality(bid_order_counts)),
    CHECK (cardinality(ask_prices) = cardinality(ask_depths)
       AND cardinality(ask_prices) = cardinality(ask_order_counts)),
    CHECK ((best_bid_price IS NOT NULL AND best_ask_price IS NOT NULL) = (spread IS NOT NULL)),
    CHECK ((spread IS NULL) = (mid_price IS NULL))
);
CREATE INDEX book_snapshots_instrument_seq_idx ON core.book_snapshots (run_id, instrument_id, sequence_number);
CREATE INDEX book_snapshots_time_idx           ON core.book_snapshots (run_id, instrument_id, snapshot_timestamp);

-- 008 · Surveillance features
-- Spec 3.8. Long format: one row per (entity, feature, window, stage).
CREATE TABLE analytics.surveillance_features (
    run_id              TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    feature_row_id      BIGINT GENERATED ALWAYS AS IDENTITY,
    feature_timestamp   TIMESTAMPTZ NOT NULL,
    observation_start   TIMESTAMPTZ NOT NULL,
    observation_end     TIMESTAMPTZ NOT NULL,
    feature_name        TEXT NOT NULL,
    feature_value_num   DOUBLE PRECISION,
    feature_value_cat   TEXT,
    entity_type         analytics.entity_type_t NOT NULL,
    entity_id           TEXT NOT NULL,
    feature_version     TEXT NOT NULL,
    scoring_stage       analytics.scoring_stage_t NOT NULL,
    data_quality_status TEXT NOT NULL DEFAULT 'OK',
    context             JSONB,
    PRIMARY KEY (run_id, feature_row_id),
    CHECK (observation_end >= observation_start),
    CHECK (feature_value_num IS NULL OR feature_value_cat IS NULL)
);
CREATE UNIQUE INDEX surveillance_features_natural_key
    ON analytics.surveillance_features
       (run_id, entity_type, entity_id, feature_name, feature_version, scoring_stage, observation_start, observation_end);
CREATE INDEX surveillance_features_entity_idx
    ON analytics.surveillance_features (run_id, entity_type, entity_id);

-- 009 · Scenario manifest
-- Spec 3.9 / 11.2. Ground truth lives in the separate labels schema.
CREATE TABLE labels.scenario_manifest (
    run_id                     TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    scenario_id                TEXT NOT NULL,
    scenario_type              TEXT NOT NULL,
    scenario_version           TEXT NOT NULL,
    instrument_id              TEXT NOT NULL,
    start_timestamp            TIMESTAMPTZ NOT NULL,
    end_timestamp              TIMESTAMPTZ NOT NULL,
    related_order_ids          TEXT[] NOT NULL DEFAULT '{}',
    related_event_ids          TEXT[] NOT NULL DEFAULT '{}',
    related_trade_ids          TEXT[] NOT NULL DEFAULT '{}',
    intended_pattern            TEXT NOT NULL,
    ground_truth_label         labels.ground_truth_label_t NOT NULL,
    pattern_class              TEXT,
    control_type               TEXT,
    event_association          labels.event_association_t NOT NULL DEFAULT 'NOT_APPLICABLE',
    evaluation_label           labels.evaluation_label_t NOT NULL,
    label_rationale            TEXT NOT NULL,
    expected_feature_behaviour JSONB,
    acceptance_criterion       JSONB NOT NULL,
    validation_status          quality.validation_status_t NOT NULL DEFAULT 'PENDING',
    validation_reason          TEXT,
    random_seed                BIGINT NOT NULL,
    PRIMARY KEY (run_id, scenario_id),
    FOREIGN KEY (run_id, instrument_id) REFERENCES core.instrument_master (run_id, instrument_id),
    CHECK (end_timestamp >= start_timestamp),
    CHECK (validation_status <> 'FAIL' OR validation_reason IS NOT NULL)
);

-- 010 · Validation results
-- Validation is a gate; every check records an explicit, machine-readable result.
CREATE TABLE quality.validation_results (
    run_id         TEXT NOT NULL REFERENCES quality.run_metadata (run_id),
    result_id      BIGINT GENERATED ALWAYS AS IDENTITY,
    check_id       TEXT NOT NULL,
    requirement_id TEXT,
    scope          TEXT NOT NULL,
    scenario_id    TEXT,
    status         quality.validation_status_t NOT NULL,
    message        TEXT,
    details        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, result_id),
    CHECK (status <> 'FAIL' OR message IS NOT NULL)
);
CREATE INDEX validation_results_status_idx ON quality.validation_results (run_id, status);

-- Post-script · Label-free model input views
-- The model_input schema exposes label-free views over the source tables.
DROP VIEW IF EXISTS model_input.instrument_master CASCADE;
DROP VIEW IF EXISTS model_input.order_events CASCADE;
DROP VIEW IF EXISTS model_input.order_state CASCADE;
DROP VIEW IF EXISTS model_input.trades CASCADE;
DROP VIEW IF EXISTS model_input.book_snapshots CASCADE;
DROP VIEW IF EXISTS model_input.surveillance_features CASCADE;

CREATE VIEW model_input.instrument_master AS
    SELECT * FROM core.instrument_master;

CREATE VIEW model_input.order_events AS
    SELECT run_id, event_id, instrument_id, venue_id, event_timestamp, sequence_number,
           order_id, parent_order_id, participant_id, account_id, side, event_type, price,
           order_qty, event_qty, remaining_qty, order_type, time_in_force, source_sequence,
           exchange_order_status, data_quality_flag, reason_code, trade_id, is_engine_generated
    FROM core.order_events;

CREATE VIEW model_input.order_state AS
    SELECT run_id, order_id, instrument_id, participant_id, account_id, side, order_type,
           time_in_force, parent_order_id, limit_price, original_qty, amended_qty_delta,
           filled_qty, cancelled_qty, remaining_qty, creation_timestamp, last_update_timestamp,
           status, queue_priority_timestamp
    FROM core.order_state;

CREATE VIEW model_input.trades AS
    SELECT run_id, trade_id, instrument_id, trade_timestamp, price, quantity, buy_order_id,
           sell_order_id, buy_participant_id, sell_participant_id, aggressor_side, execution_status
    FROM core.trades;

CREATE VIEW model_input.book_snapshots AS
    SELECT * FROM core.book_snapshots;

CREATE VIEW model_input.surveillance_features AS
    SELECT run_id, feature_timestamp, observation_start, observation_end, feature_name,
           feature_value_num, feature_value_cat, entity_type, entity_id, feature_version,
           scoring_stage, data_quality_status, context
    FROM analytics.surveillance_features;

-- Post-script · Immutable events and run purge
CREATE OR REPLACE FUNCTION core.forbid_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND coalesce(current_setting('app.allow_purge', true), 'off') = 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'TRUNCATE' AND coalesce(current_setting('app.allow_purge', true), 'off') = 'on' THEN
        RETURN NULL;
    END IF;
    RAISE EXCEPTION 'core.order_events is immutable (REQ-OPS05): % is not allowed', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS order_events_immutable_row ON core.order_events;
CREATE TRIGGER order_events_immutable_row
    BEFORE UPDATE OR DELETE ON core.order_events
    FOR EACH ROW EXECUTE FUNCTION core.forbid_event_mutation();

DROP TRIGGER IF EXISTS order_events_immutable_truncate ON core.order_events;
CREATE TRIGGER order_events_immutable_truncate
    BEFORE TRUNCATE ON core.order_events
    FOR EACH STATEMENT EXECUTE FUNCTION core.forbid_event_mutation();

CREATE OR REPLACE FUNCTION core.purge_run(p_run_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.allow_purge', 'on', true);
    DELETE FROM quality.validation_results      WHERE run_id = p_run_id;
    DELETE FROM labels.scenario_manifest         WHERE run_id = p_run_id;
    DELETE FROM analytics.surveillance_features WHERE run_id = p_run_id;
    DELETE FROM core.book_snapshots              WHERE run_id = p_run_id;
    DELETE FROM core.trades                      WHERE run_id = p_run_id;
    DELETE FROM core.order_events                WHERE run_id = p_run_id;
    DELETE FROM core.order_state                 WHERE run_id = p_run_id;
    DELETE FROM core.instrument_master           WHERE run_id = p_run_id;
    DELETE FROM quality.run_metadata             WHERE run_id = p_run_id;
    PERFORM set_config('app.allow_purge', 'off', true);
END;
$$;

-- Post-script · Database roles and grants
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'model_reader') THEN
        CREATE ROLE model_reader NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evaluator') THEN
        CREATE ROLE evaluator NOLOGIN;
    END IF;
END
$$;

REVOKE ALL ON SCHEMA core, analytics, labels, quality FROM model_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA core, analytics, labels, quality FROM model_reader;

GRANT USAGE ON SCHEMA model_input TO model_reader, evaluator;
GRANT SELECT ON ALL TABLES IN SCHEMA model_input TO model_reader, evaluator;

GRANT USAGE ON SCHEMA analytics, labels, quality TO evaluator;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics, labels, quality TO evaluator;
