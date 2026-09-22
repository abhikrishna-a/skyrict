# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.1] - 2026-09-22

First public beta of the Skyrict multi-tenant business suite. Released through
REL-GATE-001: all E2E/perf/security suites green on the `beta` branch, a
Postgres PITR restore drill passing exact-hash parity, 24–48 h Azure soak with
clean logs, and a rehearsed rollback. See
[docs/runbooks/azure-release.md](docs/runbooks/azure-release.md) and
[docs/releases/2026-09-beta-1-gate.md](docs/releases/2026-09-beta-1-gate.md).

### Added

- **Identity service** (0.1.0): JWT access/refresh auth, registration,
  login/logout, MFA (TOTP setup/verify), session management and revocation,
  multi-tenant RBAC with row-level security, audit logging, RFC 7807 error
  responses, strict tenant-resolution middleware, Alembic-managed schema
  (head `0032`).
- **Core service** (0.1.0): ERP modules — CRM (leads, opportunities,
  customers, activities), payroll, inventory, orders, finance (accounts,
  journal entries, invoices, budgets, expenses, statements), HR (employees,
  leave, attendance, attrition, planning), reports (cached aggregates) and
  documents — with workflows/approvals and a reporting engine. Alembic head
  `0063`.
- **AI agent service** (0.1.0): agents for chat, natural-language inventory
  lookups, a report builder, a finance advisor, and document AI; Coaching and
  Guardian agent experiences; Ollama-backed local inference. Alembic head
  `0028`.
- **Web app**: Next.js 15 workspace with four tenant-routed subdomains
  (marketing, signup, signin, workspace), ERP/AI/analytics dashboards, and
  RBAC-driven UI.
- **Azure beta environment**: Container Apps (identity, core, ai-agent) with
  scale-to-zero, Flexible Postgres 16 with `vector` + `pg_trgm` (7-day
  backup retention, PITR), Azure Cache for Redis, ACR, Key Vault, Log
  Analytics, and subscription budgets — deployed by an OIDC CD workflow with
  an idempotency gate (`docs/runbooks/azure-iac.md`).
- **QA infrastructure**: Playwright E2E suite (reports-smoke, CRM/finance,
  AI, perf, security projects), Lighthouse performance budgets, backend
  performance gates (`bench-core`), CodeQL and gitleaks scans, and a
  Postgres restore-drill parity toolchain (`scripts/azure/pg-parity.sql`).

### Changed

- Root README: CI status badge and "Roadmap & Scope" section kept accurate;
  stage badge moved to Beta with the release.
- Local dev infrastructure: Kafka deferred until 3+ services need decoupled
  async events; local stack runs pgvector/Postgres 18, Redis 7, mailpit and
  nginx tenant routing.

### Fixed

- Identity service: registration/login commits on success (writes were rolled
  back at session close), cross-module ORM relationships registered through
  `identity/db/models.py`, and the `RoleModel.tenant_id` foreign key.
- Core service: database upgrades run through Alembic jobs in dependency
  order (previously a stale upgrade head could leave tables missing).

[Unreleased]: https://github.com/nkswalih/skyrict/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/nkswalih/skyrict/releases/tag/v0.1.0-beta.1

### Added

- Workspace-based monorepo structure with `uv` (Python) and `pnpm` (Node.js)
- Identity service scaffold with full layering (api, core, domain, services, repositories, models, schemas, events, db)
- Identity service: JWT auth (access + refresh tokens), user registration, login, logout, token refresh
- Identity service: multi-tenancy via ContextVar-based TenantContext with RLS support
- Identity service: middleware stack (request-id, tenant context, timing)
- Identity service: MFA (TOTP setup/verify), passkey stubs, SSO stubs
- Identity service: session management (list, revoke, revoke all)
- Identity service: audit logging
- Identity service: async SQLAlchemy 2.0 with Alembic migrations
- Identity service: Dockerfile for container builds
- `libs/skyrict-common` - shared exceptions, logging, pagination, response envelopes
- `libs/skyrict-events` - shared Kafka event schemas and producer/consumer base classes
- `services/_template` - copy-to-bootstrap scaffold for new services
- Next.js 15 web app skeleton (auth routes, dashboard routes)
- Docker Compose for local dev (PostgreSQL 16, Redis 7; Kafka optional/commented-out until in scope)
- CI/CD workflows: ci-identity, ci-web, codeql, cd-staging, cd-production
- Dependabot for pip, npm, Docker, and GitHub Actions auto-updates
- CODEOWNERS with team-based review routing
- Issue templates (bug report, feature request)
- Pull request template
- ADR-001: Use uv workspaces for Python monorepo
- ADR-002: Single identity service with internal modules
- Makefile with 20+ dev targets
- Pre-commit hooks (Ruff, mypy, commitlint, file checks)
- `.tool-versions` for pinned Python/Node versions
- Identity service: RFC 7807 (problem+json) error responses with correct HTTP status mapping for all domain exceptions
- Identity service: structured JSON logging with full tracebacks and request_id/tenant_id context injection
- `libs/skyrict-common` - `NotFoundError`, `PermissionDeniedError`, `ConflictError` domain exceptions
- Root README: CI status badge and "Roadmap & Scope" section
- Local multi-tenant routing: nginx dev proxy routes `*.localhost` subdomains (and a path-based fallback) to the identity service with `X-Tenant-Slug` injected, for parity with production tenant subdomain routing
- Identity service: strict tenant resolution in middleware - tenant slug from `Host` subdomain in staging/production (`IDENTITY_BASE_DOMAIN` required, fail-fast) or `X-Tenant-Slug` header in dev/test; unknown/disabled/unresolvable tenants return RFC 7807 404/403/400
- Identity service: `TenantContext` carries `tenant_id`, `user_id`, `roles`, and `permissions` for every request
- Identity service: JWT `tenant_id` claim cross-checked against the routed tenant on every authenticated request (mismatch → 401 `application/problem+json`)
- Identity service: login/register issue tokens bound to the routed tenant
- Identity service: DB-backed integration suite proving tenant isolation (same-tenant 200, cross-tenant 401, tenant resolution, context lifecycle, token binding)
- `libs/skyrict-common` - `TenantMismatchError` for tenant cross-check failures

### Changed

- Root README: correction pass - repository structure diagram matches the current tree, architecture labeled as target roadmap, GitHub URL made consistent
- Local dev infrastructure: Kafka commented out (deferred) until 3+ services need decoupled async events

### Fixed

- Identity service: registration/login never committed - every write (user rows, audit logs, session revocation) was rolled back on session close, silently dropping new users; `get_db` now commits on success
- Identity service: cross-module ORM relationships failed to configure at runtime (`KeyError` on first DB query); all models are now registered through `identity/db/models.py`
- Identity service: `RoleModel.tenant_id` was missing a `ForeignKey` - the tenant→roles relationship was undeclarable and the schema incomplete
