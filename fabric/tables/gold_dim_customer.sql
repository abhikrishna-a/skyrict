-- Gold: dim_customer (SCD-1, latest wins)
CREATE TABLE IF NOT EXISTS gold_dim_customer (
    customer_key            UUID NOT NULL PRIMARY KEY,
    tenant_id               UUID NOT NULL,
    source_customer_id      UUID NOT NULL,
    customer_code           VARCHAR(64) NOT NULL,
    name                    VARCHAR(255) NOT NULL,
    email                   VARCHAR(255),
    phone                   VARCHAR(32),
    credit_limit            NUMERIC(18,4) NOT NULL DEFAULT 0,
    credit_currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    source_opportunity_id   UUID,
    first_seen_at           TIMESTAMPTZ NOT NULL,
    last_updated_at         TIMESTAMPTZ NOT NULL,
    _loaded_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_dim_customer_tenant ON gold_dim_customer (tenant_id);
