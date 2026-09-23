-- Silver: erp_journal_lines
CREATE TABLE IF NOT EXISTS silver_journal_lines (
    tenant_id       UUID NOT NULL,
    id              UUID NOT NULL,
    entry_id        UUID NOT NULL,
    account_id      UUID NOT NULL,
    description     VARCHAR(500),
    debit           NUMERIC(18,4) NOT NULL DEFAULT 0,
    credit          NUMERIC(18,4) NOT NULL DEFAULT 0,
    currency_code   VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(18,4) NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE silver_journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY silver_journal_lines_tenant_isolation ON silver_journal_lines
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
