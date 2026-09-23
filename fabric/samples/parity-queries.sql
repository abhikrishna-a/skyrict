-- Parity queries: Gold totals must match the canonical seeded totals
-- (skyrict_fabric/seed.py, build_seed()). These are the queries BI-PBI-001
-- compares its measure values against. Expected values are in the comments.
--
-- Run against the Gold tables after gold-build + upsert. All aggregates are
-- per-currency -- never sum across currencies.

-- ============================================================================
-- fact_deals (won opportunities only)
-- Expected: 2 rows; USD 1000.0000; EUR 2000.0000
-- ============================================================================
SELECT currency_code,
       COUNT(*)        AS deal_count,
       SUM(amount)     AS total_amount
FROM gold_fact_deals
GROUP BY currency_code
ORDER BY currency_code;

-- ============================================================================
-- fact_revenue (approved/paid invoices)
-- Expected: 2 rows; USD 550.0000; EUR 1200.0000
-- ============================================================================
SELECT currency_code,
       COUNT(*)        AS revenue_count,
       SUM(total)      AS total_revenue
FROM gold_fact_revenue
GROUP BY currency_code
ORDER BY currency_code;

-- ============================================================================
-- fact_pipeline (active non-terminal opportunities)
-- Expected: 1 row; USD 3000.0000
-- ============================================================================
SELECT currency_code,
       COUNT(*)        AS pipeline_count,
       SUM(amount)     AS total_amount
FROM gold_fact_pipeline
GROUP BY currency_code
ORDER BY currency_code;

-- ============================================================================
-- Dimension counts
-- Expected: dim_customer 3; dim_rep 3 (2 owners + 1 Unassigned sentinel);
--           dim_date >= 1
-- ============================================================================
SELECT COUNT(*) AS customer_count FROM gold_dim_customer;
SELECT COUNT(*) AS rep_count       FROM gold_dim_rep;
SELECT COUNT(*) AS date_count      FROM gold_dim_date;

-- ============================================================================
-- Unassigned rep sentinel (NULL owner mapping)
-- Expected: 1 row (NIL UUID)
-- ============================================================================
SELECT COUNT(*) AS unassigned_rep_count
FROM gold_dim_rep
WHERE source_owner_id = '00000000-0000-0000-0000-000000000000';

-- ============================================================================
-- No fan-out: one row per deal grain
-- Expected: both counts equal (2 = 2)
-- ============================================================================
SELECT COUNT(*) AS deal_rows
FROM gold_fact_deals;

SELECT COUNT(DISTINCT source_opportunity_id) AS distinct_deals
FROM gold_fact_deals;

-- ============================================================================
-- No fan-out on dim/fact join: joining dim_customer must not multiply rows
-- Expected: join_count equals deal_rows (2 = 2)
-- ============================================================================
SELECT COUNT(*) AS join_count
FROM gold_fact_deals f
JOIN gold_dim_customer c ON c.customer_key = f.customer_key;