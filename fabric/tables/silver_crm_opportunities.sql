-- Silver: erp_crm_opportunities
CREATE TABLE IF NOT EXISTS silver_crm_opportunities (
    tenant_id           UUID NOT NULL,
    id                  UUID NOT NULL,
    name                VARCHAR(255) NOT NULL,
    lead_id             UUID,
    stage               VARCHAR(32) NOT NULL DEFAULT 'prospecting',
    amount              NUMERIC(18,4),
    currency_code       VARCHAR(3),
    probability         INTEGER NOT NULL DEFAULT 0,
    expected_close_date DATE,
    owner_id            UUID,
    team_id             UUID,
    won_at              TIMESTAMPTZ,
    lost_at             TIMESTAMPTZ,
    lost_reason         VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    _loaded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_crm_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_crm_opportunities_tenant_isolation ON silver_crm_opportunities
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS ix_silver_crm_opps_tenant_stage ON silver_crm_opportunities (tenant_id, stage);
