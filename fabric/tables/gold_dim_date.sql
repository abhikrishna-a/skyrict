-- Gold: dim_date (one row per calendar date)
CREATE TABLE IF NOT EXISTS gold_dim_date (
    date_key        INTEGER NOT NULL PRIMARY KEY,
    date_value      DATE NOT NULL,
    year            INTEGER NOT NULL,
    month           INTEGER NOT NULL,
    day             INTEGER NOT NULL,
    quarter         INTEGER NOT NULL,
    month_name      VARCHAR(20) NOT NULL,
    day_of_week     VARCHAR(15) NOT NULL,
    is_weekend      BOOLEAN NOT NULL DEFAULT FALSE,
    fiscal_year     INTEGER,
    _loaded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
