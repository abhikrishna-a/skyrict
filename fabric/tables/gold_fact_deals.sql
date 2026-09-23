-- Gold: fact_deals (won opportunities only)
CREATE TABLE IF NOT EXISTS gold_fact_deals (
    deal_key                    UUID NOT NULL PRIMARY KEY,
    tenant_id                   UUID NOT NULL,
    source_opportunity_id       UUID NOT NULL,
    customer_key                UUID,
    rep_key                     UUID,
    won_date_key                INTEGER,
    created_date_key            INTEGER NOT NULL DEFAULT 0,
    opportunity_name            VARCHAR(255) NOT NULL,
    stage                       VARCHAR(32) NOT NULL,
    amount                      NUMERIC(18,4),
    currency_code               VARCHAR(3),
    probability                 INTEGER NOT NULL DEFAULT 0,
    won_at                      TIMESTAMPTZ,
    lead_source                 VARCHAR(32),
    created_at                  TIMESTAMPTZ NOT NULL,
    updated_at                  TIMESTAMPTZ NOT NULL,
    _loaded_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_fact_deals_tenant ON gold_fact_deals (tenant_id);
CREATE INDEX IF NOT EXISTS ix_gold_fact_deals_customer ON gold_fact_deals (customer_key);
