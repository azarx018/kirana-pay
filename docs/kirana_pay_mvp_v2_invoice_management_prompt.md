# KIRANA PAY --- MVP V2: INVOICE MANAGEMENT

## Implementation Brief for AI Coding Agent

> Objective: Add reliable, merchant-scoped invoice management to the
> existing deployed Kirana Pay product without breaking QR generation.
>
> Rule: Inspect first, plan second, implement incrementally, test
> continuously. Never invent repository details, provider capabilities,
> or test results.

## 0. Project Context and Source of Truth

Known architecture (verify in repository; do not assume unchanged): -
Rust + Axum QR Engine. - NestJS 11 + TypeORM API. - PostgreSQL. -
Existing dashboard with QR generation. - Merchant Management V1 reported
complete: authentication, multi-tenant foundation, QRIS management,
provider selection, and API Key management.

Initial QRIS providers: - `DANA_BUSINESS` - `GOPAY_MERCHANT` -
`SHOPEEPAY_MERCHANT`

A merchant may own multiple QRIS records. Each QRIS has a provider, a
separate merchant-defined display name, and its own QR payload/image
metadata.

Inspect: - `docs/kirana_pay_backend_mvp_ai_brief.md` - Existing
architecture/API documentation. - Merchant Management V1
documentation. - Actual source code, migrations, tests, and README.

If a feature or document is absent, report it. Do not pretend it exists.

## 1. Scope --- Invoice Management Only

### In scope

1.  Create invoices for the authenticated merchant.
2.  List and retrieve only that merchant's invoices.
3.  Generate an amount-specific QR using an existing merchant-owned QRIS
    and existing Rust QR Engine.
4.  Persist invoice and QR metadata using existing storage abstractions.
5.  Enforce invoice expiration.
6.  Allow explicit manual payment confirmation by an authorized merchant
    user, with audit data.
7.  Show invoice status/history in the existing dashboard.
8.  Add validation, migrations, logs, tests, and documentation.

### Explicitly out of scope

Do NOT implement: - Android Companion, device pairing,
NotificationListenerService, or notification ingestion. - Automatic
transaction detection or matching. - Automatic payment confirmation. -
Public Payment Link or customer-facing checkout. - Public developer
invoice API or webhooks. - Subscription billing, wallet, balance
holding, settlement, routing, or funds custody. - New provider
integrations. - Unrequested dashboard redesign.

These belong to later milestones.

## 2. Critical Payment Semantics

Creating an invoice or generating its QR does NOT mean it is paid.

Recommended statuses: - `PENDING`: awaiting payment. - `PAID`: merchant
explicitly recorded/confirmed receipt. - `EXPIRED`: expiry passed while
unpaid. - `CANCELLED`: optional, only if a clear cancellation workflow
is approved.

Do not add speculative statuses.

Rules: - QR generation leaves invoice `PENDING`. - Page refresh, QR
display/download, browser return, customer claims, or client-side input
must never mark an invoice `PAID`. - Only an authenticated, authorized
merchant user can manually confirm payment in this MVP. - Record who
confirmed it and when. - Never accept `paid_at`, `confirmed_by_user_id`,
merchant identity, or arbitrary status from the client. - Do not
silently revert `PAID` to `PENDING` or `EXPIRED`. - Expiration must
never overwrite `PAID`. - Repeated confirmation must be idempotent or
return a clear conflict without duplicate audit events. - If an invoice
is expired, reject confirmation unless a separately designed and
approved exception flow exists. - UI must clearly say "Marked as paid by
merchant"; it is not automatic provider verification. - If mistaken
confirmation reversal is not safely designed, leave reversal out of
scope and document the limitation.

## 3. Required Workflows

### 3.1 Create invoice

1.  Merchant signs in.
2.  Backend derives merchant context from authenticated identity and
    authorized membership. Never trust client-supplied `merchant_id`.
3.  Merchant opens Invoices → Create Invoice.
4.  Merchant enters:
    -   Amount: required, positive integer, within configured limits.
    -   Description/title: decide required vs optional based on current
        UX conventions and document the decision.
    -   QRIS: required, active, and owned by this merchant.
    -   Expiration: define a sensible default and allowed range;
        document it.
    -   Optional merchant reference only if uniqueness/privacy behavior
        is defined.
5.  Backend validates fields and ownership.
6.  Backend creates a unique, non-guessable invoice public identifier.
7.  Backend invokes the existing Rust QR Engine with the selected QRIS
    source and invoice amount, following the existing tested conversion
    flow.
8.  Persist invoice and QR reference/metadata.
9.  Return invoice details and authorized QR representation to the
    dashboard.
10. Invoice remains `PENDING`.

Reuse the existing QR Engine. Do not duplicate transformation logic in
NestJS or invent QRIS rules.

If QR generation fails, do not leave a misleading usable invoice. Use an
appropriate DB transaction/failure strategy. Account for
file/object-storage side effects and clean up orphaned artifacts where
practical.

### 3.2 List and view invoices

Merchant can list and view only their own invoices. Display: - Public
invoice ID. - Amount/currency. - Description. - Status. - Selected QRIS
display name and provider. - Created, expiry, and paid timestamps. - QR
representation while valid/unpaid if supported by storage design.

Filtering by status/date and bounded pagination are desirable if they
fit existing patterns.

Tenant isolation applies to list, detail, update, cancellation,
confirmation, and QR retrieval.

### 3.3 Expiration

-   Store timestamps in UTC.
-   API timestamps must be timezone-aware ISO 8601.
-   Render in dashboard locale.
-   Expiration must be enforced by backend, not only a frontend timer.
-   If no scheduler already exists, prefer a simple idempotent
    lazy-expiration strategy rather than introducing Redis/queues just
    for this milestone.
-   Define race behavior between expiry and manual confirmation.
-   Never expire a `PAID` invoice.
-   Document the chosen expiration strategy.

### 3.4 Manual confirmation

1.  Merchant opens a `PENDING` invoice.
2.  Clicks Mark as Paid.
3.  UI asks for confirmation and explains it is a manual merchant
    action.
4.  Backend rechecks authentication, ownership, status, and expiry.
5.  Backend atomically transitions `PENDING` → `PAID`.
6.  Server records `paid_at`, `confirmed_by_user_id`, and
    `confirmation_method = MANUAL_MERCHANT`.
7.  Duplicate requests do not create duplicate audit events.
8.  Return updated invoice.

Do not allow client-supplied identity or confirmation timestamps. Do not
auto-confirm from QR generation, page return, or unverified signals.

## 4. Data Model Proposal

Inspect existing entities first. Reuse equivalent structures; do not
duplicate tables.

Potential `invoices` fields: - `id` --- UUID or existing project
convention. - `public_id` --- unique, non-sequential identifier. -
`merchant_id`. - `merchant_qris_id`. - `amount` --- integer rupiah or
integer minor units according to existing convention; document unit.
Never floating point. - `currency` --- `IDR` if product is IDR-only. -
`description`. - `status`. - `created_at`, `updated_at`, `expires_at`. -
`paid_at` nullable. - `confirmed_by_user_id` nullable. -
`confirmation_method` nullable. - `merchant_reference` nullable only
with documented uniqueness rules. - QR image/object reference or
metadata using existing storage abstraction.

Auditability: - Use an existing audit mechanism or add a small
`invoice_events` / `invoice_audit_logs` table. - At minimum, manual
confirmation must be traceable to user and timestamp.

Constraints and relationships: - Invoice belongs to exactly one
merchant. - Invoice references a QRIS belonging to the same merchant. -
Unique `public_id`. - Positive amount constraint. - Valid status
constraint. - Index merchant + created date, merchant + status, public
ID, and expiry lookup as appropriate. - Preserve financial/audit
history. Avoid cascading deletion of invoices when a QRIS is removed. -
Use migrations, never manual-only schema changes. - Explain how QRIS
replacement/deletion affects historical invoices. Prefer
archive/restrict behavior or immutable references.

## 5. API Contract Proposal

Inspect route conventions and response envelopes; adapt these paths as
appropriate:

-   `POST /v1/invoices` --- create.
-   `GET /v1/invoices` --- list current merchant invoices; bounded
    pagination and optional filters.
-   `GET /v1/invoices/:id` --- retrieve current merchant's invoice.
-   `POST /v1/invoices/:id/confirm-payment` --- manual confirmation.
-   `POST /v1/invoices/:id/cancel` --- optional, only if approved.
-   `GET /v1/invoices/:id/qr` --- retrieve QR if separate retrieval is
    needed.

Rules: - Never accept `merchant_id` as authority. - Validate amount as
integer; reject zero, negative, decimal, overflow, and out-of-range
values. - Validate QRIS ownership and active status. - Validate expiry
within configured bounds. - Allowlist filters and sort fields. - Use
consistent not-found behavior for cross-tenant IDs to avoid leaking
existence. - Return only necessary fields: public ID, amount/currency,
description, status, QRIS display name/provider, timestamps, and
authorized QR reference/data. - Never expose internal storage paths,
secrets, or other merchants' data. - Document authentication and
success/error schemas in Swagger.

## 6. Dashboard UX

Extend the existing dashboard; do not replace it unnecessarily.

Brand tokens: - Light: Warm Ivory `#F7F6F3`, Obsidian `#171717`, White
`#FFFFFF`, Soft Stone `#D9D5CE`, Muted Champagne `#A68B67`. - Dark: Deep
Charcoal/Obsidian surfaces with restrained Champagne accents. - Preserve
the existing black line-art female cashier brand mark. - Maintain
responsive behavior and existing design conventions.

Required screens: 1. Invoice list/history. 2. Create invoice form. 3.
Invoice detail. 4. QR display. 5. Manual payment confirmation dialog. 6.
Loading, empty, validation-error, API-error states.

Create form: - Amount. - Description. - QRIS selector showing both QR
display name and provider. - Expiration choice based on documented
backend policy. - Clear validation and loading state.

List: - Invoice ID, amount, QRIS display name/provider, status,
created/expiry time, detail action.

Detail: - QR image if available. - Invoice information. - Status/audit
history suitable for merchant. - Mark-as-paid only when permitted. -
Clear notice that manual confirmation is not automatic verification.

Never fabricate charts, totals, transactions, or statuses. Display
actual API data only.

## 7. Security and Reliability

Implement and test: - Authentication and merchant ownership on every
invoice/QR resource. - Role/authorization checks. - Integer-safe money;
no floating point. - Input bounds and validation. - Safe QR retrieval. -
Rate limits for creation/confirmation as appropriate. - Atomic status
transitions. - Idempotent manual confirmation. - Expiry/confirmation
race handling. - No client control of status or confirmer identity. - No
sensitive data in logs. - UTC storage and timezone-aware API values. -
DB transaction boundaries and storage cleanup. - Migration rollback or
documented forward-only policy. - Preserve QR conversion regression
tests and E2E tests.

Never mark paid based on QR generation, QR download/display, customer
return, query parameter, unverified screenshot, or customer self-report.

## 8. Testing Requirements

Unit tests: - Amount validation and integer precision. - Expiry
calculations and boundaries. - Allowed status transitions. - Public ID
generation. - QRIS ownership/provider relationship.

Integration tests: - Merchant A creates invoice using own QRIS. - Reject
QRIS belonging to merchant B. - List/detail only returns current
merchant's invoices. - Cross-tenant QR retrieval is rejected. - Reject
invalid amounts (negative, zero, decimal, overflow, out of bounds). - QR
generation failure leaves no misleading usable invoice. - Manual
confirmation records authenticated user and server timestamp. -
Expired/cancelled/already-paid invoices cannot be improperly
confirmed. - Duplicate confirmation creates no duplicate audit event. -
Expiration never overwrites PAID. - Cancellation behavior, if
implemented.

Regression/E2E: - Existing QR generator still works. - Existing QR
Engine tests and parity tests still pass. - Create invoice → decode
output QR → verify expected amount-specific payload. - Invoice remains
PENDING after QR generation. - Manual confirmation → PAID with audit
metadata. - Merchant B cannot read Merchant A invoice or QR. - Data
persists after DB/service restart. - Existing auth/API Key tests remain
green.

Use deterministic clocks and fixtures where practical. Do not depend on
live payment apps or real transactions in automated tests.

## 9. Strict Implementation Sequence

### Stage 0 --- Repository and Product Audit

-   Inspect actual code and docs.
-   Verify Merchant Management V1.
-   Map QR generation and storage flow.
-   Inspect schema/API conventions.
-   Identify gaps, risks, and compatibility issues.
-   Do not modify code yet.

### Stage 1 --- Invoice Design

-   Propose entities, relations, migrations, indexes.
-   Decide amount unit, expiry policy, status transitions, manual
    confirmation semantics, QR storage.
-   Propose API contract and dashboard flow.
-   Write concise ADRs.
-   Stop for approval if a genuine product decision is ambiguous.

### Stage 2 --- Backend Foundation

-   Add entities, migrations, constraints, indexes.
-   Add DTOs and validation.
-   Add invoice service and ownership enforcement.
-   Add unit/integration tests.

### Stage 3 --- QR Engine Integration

-   Reuse existing Rust QR Engine.
-   Generate invoice-specific QR from selected merchant QRIS and amount.
-   Persist QR reference safely.
-   Handle failures and cleanup.
-   Add regression tests.

### Stage 4 --- Invoice API

-   Implement create/list/detail/QR retrieval.
-   Implement expiration.
-   Implement manual confirmation.
-   Add cancellation only if approved.
-   Add Swagger and API tests.

### Stage 5 --- Dashboard

-   Add list, create, detail, QR display, and manual confirmation UI.
-   Reuse existing auth/session and design system.
-   Add loading, empty, error, and responsive states.

### Stage 6 --- Verification and Handover

-   Run lint, typecheck, build, unit, integration, and E2E tests.
-   Run existing Rust QR Engine tests and dashboard tests.
-   Review tenant isolation and status transitions.
-   Update README/docs.
-   Provide factual completion report.

## 10. Anti-Hallucination Rules --- Mandatory

1.  Inspect actual repository files before making assumptions.
2.  Never claim a command, test, migration, deployment, or payment was
    run unless it actually ran and output was observed.
3.  Never invent files, endpoints, env vars, provider APIs, tables, or
    test results.
4.  If a detail is unknown, inspect or explicitly ask. Do not guess
    silently.
5.  Do not rewrite the Rust QR Engine without demonstrated need.
6.  Do not expand scope into Android, automatic detection, webhooks, or
    Payment Link.
7.  Do not automatically mark invoices PAID.
8.  Never use floating point for money.
9.  Never trust frontend-supplied merchant identity.
10. Never weaken/delete tests just to pass a build.
11. Do not swallow errors or return fake success.
12. Do not leave TODO placeholders in a feature reported as complete.
13. If blocked, state the exact blocker and stop that part.
14. After each stage, report changed files, commands actually run,
    observed test results, and remaining risks.
15. Conserve tokens: inspect targeted files, avoid dumping the entire
    repository, reuse established patterns, and do not regenerate docs
    unnecessarily.

## 11. Definition of Done

MVP V2 is complete only when: - Authenticated merchant can create an
invoice using one of their own QRIS records. - QR output represents
invoice amount using the existing tested Rust QR Engine. - Invoice is
persisted and remains PENDING after creation. - Merchant can list/view
only their own invoices. - Expiry is enforced consistently. - Merchant
can explicitly mark an eligible invoice paid, with auditable user/time
metadata. - UI distinguishes manual confirmation from automatic
verification. - Cross-merchant access tests pass. - Existing QR
generation behavior and tests remain intact. - Migrations, docs, and
operational instructions are updated. - Build, lint, unit, integration,
and E2E results are reported truthfully.

**Start with Stage 0. Do not jump straight into implementation.**
