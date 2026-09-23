-- Silver: erp_crm_leads
CREATE TABLE IF NOT EXISTS silver_crm_leads (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'new',
    source          VARCHAR(32),
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    email           VARCHAR(255),
    phone           VARCHAR(32),
    company         VARCHAR(255),
    owner_id        UUID,
    team_id         UUID,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_crm_leads_tenant_isolation ON silver_crm_leads
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS ix_silver_crm_leads_tenant_status ON silver_crm_leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_silver_crm_leads_tenant_owner ON silver_crm_leads (tenant_id, owner_id);
