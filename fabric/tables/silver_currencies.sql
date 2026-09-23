-- Silver: erp_currencies (global, not tenant-scoped)
CREATE TABLE IF NOT EXISTS silver_currencies (
    code            VARCHAR(3) NOT NULL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    symbol          VARCHAR(10) DEFAULT '',
    decimal_places  INTEGER NOT NULL DEFAULT 2,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
