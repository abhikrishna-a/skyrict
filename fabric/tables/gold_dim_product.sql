-- Gold: dim_product (SCD-1, latest wins)
CREATE TABLE IF NOT EXISTS gold_dim_product (
    product_key         UUID NOT NULL PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    source_product_id   UUID NOT NULL,
    sku                 VARCHAR(128) NOT NULL,
    name                VARCHAR(255) NOT NULL,
    description         VARCHAR(1000),
    cost_price          NUMERIC(18,4) NOT NULL DEFAULT 0,
    cost_currency       VARCHAR(3) NOT NULL DEFAULT 'USD',
    sell_price          NUMERIC(18,4) NOT NULL DEFAULT 0,
    sell_currency       VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at       TIMESTAMPTZ NOT NULL,
    last_updated_at     TIMESTAMPTZ NOT NULL,
    _loaded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_dim_product_tenant ON gold_dim_product (tenant_id);
