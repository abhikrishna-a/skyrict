# SKY-99 backend performance gates

- run: 2026-09-22T20:01:57.661107+00:00
- samples: 3, warmup: 1
- passed: 8/8

| Case | p95 (ms) | median (ms) | work stmts (med/max) | ref p95 (ms) | status |
| --- | --- | --- | --- | --- | --- |
| duplicates | 6.2 | 6.2 | 1/1 | - | PASS |
| cashflow_projection | 6.1 | 6.1 | 1/1 | 13.1 | PASS |
| cashflow_naive_loop | 11.6 | 11.6 | 6/6 | - | PASS |
| working_capital_series | 25.9 | 25.9 | 6/6 | - | PASS |
| working_capital_serial | 16.5 | 16.5 | 6/6 | - | PASS |
| report_cache_hit | 5.8 | 5.8 | 1/1 | - | PASS |
| report_aggregate_recompute | 5.2 | 5.2 | 1/1 | - | PASS |
| report_cache_miss | 12.9 | 12.9 | 3/3 | - | PASS |

- `duplicates`: ok
- `cashflow_projection`: ok
- `cashflow_naive_loop`: ok
- `working_capital_series`: ok
- `working_capital_serial`: ok
- `report_cache_hit`: ok
- `report_aggregate_recompute`: ok
- `report_cache_miss`: ok
