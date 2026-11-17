    const SCHEMA_SECTIONS = [
      { title: "001 · Schemas and enum types", sql: String.raw`-- Layer separation (spec 2.5): core = raw events + state, analytics = features,
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

CREATE TYPE quality.validation_status_t AS ENUM ('PASS', 'FAIL', 'PENDING');` },
      { title: "002 · Run metadata", sql: String.raw`-- REQ-OPS04 / REQ-OPS09: seed, versions and the full configuration travel with every dataset.
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
);` },
      { title: "003 · Instrument master", sql: String.raw`-- Spec 3.2
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
);` },
      { title: "004 · Order state", sql: String.raw`-- Spec 3.5. State is derived from the event stream; it is never written independently.
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
CREATE INDEX order_state_participant_idx       ON core.order_state (run_id, participant_id);` },
      { title: "005 · Order events", sql: String.raw`-- Spec 3.3. One row per event affecting one order.
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
CREATE INDEX order_events_time_idx       ON core.order_events (run_id, event_timestamp);` },
      { title: "006 · Trades", sql: String.raw`-- Spec 3.6. A cancellation is not a trade; only real executions land here.
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
CREATE INDEX trades_instrument_time_idx ON core.trades (run_id, instrument_id, trade_timestamp);` },
      { title: "007 · Book snapshots", sql: String.raw`-- Spec 3.7. Snapshots are derived from the event stream, never generated independently.
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
CREATE INDEX book_snapshots_time_idx           ON core.book_snapshots (run_id, instrument_id, snapshot_timestamp);` },
      { title: "008 · Surveillance features", sql: String.raw`-- Spec 3.8. Long format: one row per (entity, feature, window, stage).
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
    ON analytics.surveillance_features (run_id, entity_type, entity_id);` },
      { title: "009 · Scenario manifest", sql: String.raw`-- Spec 3.9 / 11.2. Ground truth lives in the separate labels schema.
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
);` },
      { title: "010 · Validation results", sql: String.raw`-- Validation is a gate; every check records an explicit, machine-readable result.
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
CREATE INDEX validation_results_status_idx ON quality.validation_results (run_id, status);` },
      { title: "Post-script · Label-free model input views", sql: String.raw`-- The model_input schema exposes label-free views over the source tables.
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
    FROM analytics.surveillance_features;` },
      { title: "Post-script · Immutable events and run purge", sql: String.raw`CREATE OR REPLACE FUNCTION core.forbid_event_mutation() RETURNS trigger
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
$$;` },
      { title: "Post-script · Database roles and grants", sql: String.raw`DO $$
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
GRANT SELECT ON ALL TABLES IN SCHEMA analytics, labels, quality TO evaluator;` }
    ];
    const MASTER_SCHEMA_SQL = SCHEMA_SECTIONS.map(section =>
      `-- ${section.title}\n${section.sql}`
    ).join("\n\n");
    const TABLE_CATALOG = buildTableCatalog(SCHEMA_SECTIONS);
    let activeTable = null;

    function buildTableCatalog(sections) {
      const tables = [];
      const createTablePattern = /CREATE TABLE\s+([\w]+)\.([\w]+)\s*\(([\s\S]*?)\n\);/gi;

      for (const section of sections) {
        for (const match of section.sql.matchAll(createTablePattern)) {
          const [, schema, name, body] = match;
          const primaryKeys = new Set();
          const foreignKeys = [];
          for (const keyMatch of body.matchAll(/PRIMARY KEY\s*\(([^)]+)\)/gi)) {
            for (const column of keyMatch[1].split(",")) primaryKeys.add(column.trim());
          }

          const columns = [];
          for (const sourceLine of body.split("\n")) {
            const line = sourceLine.replace(/--.*$/, "").trim().replace(/,$/, "").trim();
            const columnMatch = line.match(/^([a-z][a-z0-9_]*)\s+(.+)$/i);
            if (!columnMatch || /^(primary|foreign|constraint|check|unique|deferrable|initially|on)\b/i.test(line)) continue;

            const [, columnName, definition] = columnMatch;
            const typeMatch = definition.match(/^((?:[\w]+\.)?[\w]+(?:\s*\([^)]*\))?(?:\[\])?(?:\s+precision)?)/i);
            const type = typeMatch ? typeMatch[1].replace(/\s+/g, " ").trim() : definition;
            const column = {
              name: columnName,
              type,
              definition,
              notNull: /\bNOT NULL\b/i.test(definition),
              primaryKey: primaryKeys.has(columnName) || /\bPRIMARY KEY\b/i.test(definition),
              foreignKey: false,
            };
            if (column.primaryKey) primaryKeys.add(columnName);
            columns.push(column);

            const inlineReference = definition.match(/\bREFERENCES\s+([\w]+)\.([\w]+)\s*\(([^)]+)\)/i);
            if (inlineReference) {
              const [, targetSchema, targetTable, targetColumns] = inlineReference;
              foreignKeys.push({
                columns: [columnName],
                target: `${targetSchema}.${targetTable}`,
                targetColumns: targetColumns.split(",").map(value => value.trim()),
              });
              column.foreignKey = true;
            }
          }

          for (const foreignKey of body.matchAll(
            /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([\w]+)\.([\w]+)\s*\(([^)]+)\)/gi
          )) {
            const [, sourceColumns, targetSchema, targetTable, targetColumns] = foreignKey;
            const localColumns = sourceColumns.split(",").map(value => value.trim());
            foreignKeys.push({
              columns: localColumns,
              target: `${targetSchema}.${targetTable}`,
              targetColumns: targetColumns.split(",").map(value => value.trim()),
            });
            for (const column of columns) {
              if (localColumns.includes(column.name)) column.foreignKey = true;
            }
          }

          const tableSql = match[0];
          tables.push({
            id: `${schema}.${name}`,
            schema,
            name,
            columns,
            primaryKeys: [...primaryKeys],
            foreignKeys,
            sql: tableSql,
          });
        }
      }

      return tables;
    }
    function renderSchemaSections() {
      const container = document.getElementById("schema-sections");
      const fragment = document.createDocumentFragment();
      for (const section of SCHEMA_SECTIONS) {
        const details = document.createElement("details");
        details.className = "schema-section";
        const summary = document.createElement("summary");
        const name = document.createElement("span");
        name.className = "schema-section-name";
        name.textContent = section.title;
        const count = document.createElement("span");
        count.className = "schema-section-count";
        count.textContent = `${section.sql.split("\n").length} lines`;
        summary.append(name, count);
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = section.sql;
        pre.append(code);
        details.append(summary, pre);
        fragment.append(details);
      }
      container.replaceChildren(fragment);
    }

    function setSchemaView(view) {
      for (const [name, buttonId] of [
        ["ddl", "ddl-view-button"],
        ["erd", "erd-view-button"],
        ["table", "table-view-button"],
      ]) {
        const selected = view === name;
        document.getElementById(`${name}-view`).hidden = !selected;
        document.getElementById(buttonId).setAttribute("aria-pressed", String(selected));
      }
    }

    function renderTableOptions() {
      const select = document.getElementById("table-select");
      const options = TABLE_CATALOG.map(table => {
        const option = document.createElement("option");
        option.value = table.id;
        option.textContent = table.id;
        return option;
      });
      select.replaceChildren(...options);
      activeTable = TABLE_CATALOG.find(table => table.id === "core.order_events") ?? TABLE_CATALOG[0] ?? null;
      if (activeTable) select.value = activeTable.id;
      renderSelectedTable();
    }

    function renderSelectedTable() {
      const select = document.getElementById("table-select");
      const table = TABLE_CATALOG.find(candidate => candidate.id === select.value);
      if (!table) {
        document.getElementById("table-scope").textContent = "No table selected.";
        document.getElementById("table-graph").replaceChildren();
        return;
      }
      activeTable = table;
      const incoming = [];
      const outgoing = [];
      const selfReferences = [];
      for (const candidate of TABLE_CATALOG) {
        for (const foreignKey of candidate.foreignKeys) {
          if (candidate.id === table.id && foreignKey.target === table.id) {
            selfReferences.push({ table: candidate, foreignKey });
          } else if (foreignKey.target === table.id) {
            incoming.push({ table: candidate, foreignKey });
          }
          if (candidate.id === table.id && foreignKey.target !== table.id) {
            outgoing.push({ table: TABLE_CATALOG.find(target => target.id === foreignKey.target), foreignKey });
          }
        }
      }
      const inboundCount = incoming.length;
      const outboundCount = outgoing.length;
      document.getElementById("table-scope").textContent =
        `${table.id} · ${table.columns.length} columns · ${inboundCount} incoming · ${outboundCount} outgoing declared foreign-key relationship${inboundCount + outboundCount === 1 ? "" : "s"}${selfReferences.length ? ` · ${selfReferences.length} self-reference${selfReferences.length === 1 ? "" : "s"}` : ""}`;

      const graph = document.getElementById("table-graph");
      graph.replaceChildren(
        createReferenceLane("Incoming references", incoming, "incoming"),
        createGraphConnector(incoming.length > 0),
        createFocusNode(table, selfReferences),
        createGraphConnector(outgoing.length > 0),
        createReferenceLane("Outgoing references", outgoing, "outgoing"),
      );
    }

    function createReferenceLane(title, relations, direction) {
      const lane = document.createElement("section");
      lane.className = `graph-lane graph-${direction}`;
      const heading = document.createElement("div");
      heading.className = "graph-lane-heading";
      const label = document.createElement("span");
      label.textContent = title;
      const count = document.createElement("span");
      count.className = "graph-lane-count";
      count.textContent = String(relations.length);
      heading.append(label, count);
      lane.append(heading);

      if (!relations.length) {
        const empty = document.createElement("div");
        empty.className = "graph-empty";
        empty.textContent = direction === "incoming"
          ? "No other table declares a foreign key to this table."
          : "This table does not declare outgoing foreign keys.";
        lane.append(empty);
        return lane;
      }

      const grouped = new Map();
      for (const relation of relations) {
        if (!relation.table) continue;
        if (!grouped.has(relation.table.id)) grouped.set(relation.table.id, { table: relation.table, foreignKeys: [] });
        grouped.get(relation.table.id).foreignKeys.push(relation.foreignKey);
      }
      for (const group of grouped.values()) {
        const node = document.createElement("article");
        node.className = "graph-node";
        const nodeHeader = document.createElement("div");
        nodeHeader.className = "graph-node-header";
        const name = document.createElement("span");
        name.className = "graph-node-title";
        name.textContent = group.table.name;
        const schema = document.createElement("span");
        schema.className = "graph-node-schema";
        schema.textContent = group.table.schema;
        nodeHeader.append(name, schema);

        const mappings = document.createElement("div");
        mappings.className = "graph-relations";
        for (const foreignKey of group.foreignKeys) {
          const relationCard = document.createElement("div");
          relationCard.className = "graph-relation";
          const relationLabel = document.createElement("div");
          relationLabel.className = "graph-relation-label";
          relationLabel.textContent = direction === "incoming" ? "Foreign key to focused table" : "Foreign key from focused table";
          const relationColumns = document.createElement("div");
          relationColumns.className = "graph-relation-columns";
          relationColumns.textContent = `${foreignKey.columns.join(", ")}  →  ${foreignKey.targetColumns.join(", ")}`;
          relationCard.append(relationLabel, relationColumns);
          mappings.append(relationCard);
        }
        node.append(nodeHeader, mappings);
        lane.append(node);
      }
      return lane;
    }

    function createGraphConnector(hasRelationship) {
      const connector = document.createElement("div");
      connector.className = "graph-connector";
      connector.setAttribute("aria-hidden", "true");
      if (hasRelationship) {
        const edge = document.createElement("div");
        edge.className = "graph-edge";
        connector.append(edge);
      } else {
        const empty = document.createElement("span");
        empty.className = "graph-connector-empty";
        empty.textContent = "·";
        connector.append(empty);
      }
      return connector;
    }

    function createFocusNode(table, selfReferences) {
      const lane = document.createElement("section");
      lane.className = "graph-lane graph-focus-lane";
      const heading = document.createElement("div");
      heading.className = "graph-lane-heading";
      const title = document.createElement("span");
      title.textContent = "Focused table";
      const count = document.createElement("span");
      count.className = "graph-lane-count";
      count.textContent = `${table.columns.length} columns`;
      heading.append(title, count);

      const node = document.createElement("article");
      node.className = "graph-node graph-focus";
      const nodeHeader = document.createElement("div");
      nodeHeader.className = "graph-node-header";
      const name = document.createElement("span");
      name.className = "graph-node-title";
      name.textContent = table.name;
      const schema = document.createElement("span");
      schema.className = "graph-node-schema";
      schema.textContent = table.schema;
      nodeHeader.append(name, schema);

      const columns = document.createElement("div");
      columns.className = "graph-column-list";
      for (const column of table.columns) {
        const row = document.createElement("div");
        row.className = "graph-column";
        const columnName = document.createElement("span");
        columnName.className = "graph-column-name";
        columnName.textContent = column.name;
        const type = document.createElement("span");
        type.className = "graph-column-type";
        type.textContent = column.type;
        const tags = document.createElement("span");
        tags.className = "graph-column-tags";
        if (column.primaryKey) tags.append(createKeyTag("PK", false));
        if (column.foreignKey) tags.append(createKeyTag("FK", true));
        row.append(columnName, type, tags);
        columns.append(row);
      }
      node.append(nodeHeader, columns);

      if (selfReferences.length) {
        const selfNode = document.createElement("div");
        selfNode.className = "graph-self-reference";
        const selfTitle = document.createElement("div");
        selfTitle.className = "graph-self-title";
        selfTitle.textContent = "Self-reference";
        selfNode.append(selfTitle);
        for (const { foreignKey } of selfReferences) {
          const mapping = document.createElement("div");
          mapping.className = "graph-self-map";
          mapping.textContent = `${foreignKey.columns.join(", ")}  →  ${foreignKey.targetColumns.join(", ")}`;
          selfNode.append(mapping);
        }
        node.append(selfNode);
      }

      lane.append(heading, node);
      return lane;
    }

    function createKeyTag(label, isForeignKey) {
      const tag = document.createElement("span");
      tag.className = isForeignKey ? "key-tag fk" : "key-tag";
      tag.textContent = label;
      return tag;
    }

    function showSchemaToast(message) {
      const toast = document.getElementById("toast");
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("visible");
      clearTimeout(showSchemaToast._t);
      showSchemaToast._t = setTimeout(() => toast.classList.remove("visible"), 2200);
    }

    async function copySql() {
      try {
        await navigator.clipboard.writeText(MASTER_SCHEMA_SQL);
        showSchemaToast("Master schema SQL copied.");
      } catch {
        showSchemaToast("Clipboard unavailable in this browser.");
      }
    }

    function exportSql() {
      const blob = new Blob([MASTER_SCHEMA_SQL, "\n"], { type: "text/sql;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "master_schema.sql";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showSchemaToast("master_schema.sql downloaded.");
    }

    function initMasterSchema() {
      if (!document.getElementById("schema-sections")) return;
      renderSchemaSections();
      renderTableOptions();
      document.getElementById("copy-sql").addEventListener("click", copySql);
      document.getElementById("export-sql").addEventListener("click", exportSql);
      document.getElementById("ddl-view-button").addEventListener("click", () => setSchemaView("ddl"));
      document.getElementById("erd-view-button").addEventListener("click", () => setSchemaView("erd"));
      document.getElementById("table-view-button").addEventListener("click", () => setSchemaView("table"));
      document.getElementById("table-select").addEventListener("change", renderSelectedTable);
    }
