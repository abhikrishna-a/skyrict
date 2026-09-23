-- Gold: fact_pipeline (active non-terminal opportunities)
CREATE TABLE IF NOT EXISTS gold_fact_pipeline (
    pipeline_key                UUID NOT NULL PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    source_opportunity_id       UUID NOT NULL,
    rep_key                     UUID,
    created_date_key            INTEGER NOT NULL DEFAULT 0,
    expected_close_date_key     INTEGER,
    opportunity_name            VARCHAR(255) NOT NULL,
    stage                       VARCHAR(32) NOT NULL,
    amount                      NUMERIC(18,4),
    currency_code               VARCHAR(3),
    probability                 INTEGER NOT NULL DEFAULT 0,
    days_in_stage               INTEGER NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL,
    updated_at                  TIMESTAMPTZ NOT NULL,
    _loaded_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_fact_pipeline_tenant ON gold_fact_pipeline (tenant_id);
CREATE INDEX IF NOT EXISTS ix_gold_fact_pipeline_rep ON gold_fact_pipeline (rep_key);
