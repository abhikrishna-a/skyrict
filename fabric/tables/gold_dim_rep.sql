-- Gold: dim_rep (unique owner_ids from opps + leads)
CREATE TABLE IF NOT EXISTS gold_dim_rep (
    rep_key             UUID NOT NULL PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    source_owner_id     UUID NOT NULL,
    first_seen_at       TIMESTAMPTZ NOT NULL,
    last_updated_at     TIMESTAMPTZ NOT NULL,
    _loaded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_gold_dim_rep_tenant ON gold_dim_rep (tenant_id);
