# Changelog

All notable changes to DSH Creative Workshop are recorded here.

## [1.1.1] - 2026-08-14

### Added

- Real-time homepage presence based on a 90-second foreground activity window, with shared-cookie tab deduplication, bot filtering and a 24-hour peak for administrators.
- Public discussions, replies and author deletion with plugin-scoped threads, rate limits and administrator locking or hiding.
- Public collection discovery, shareable collection details and private cloning into a signed-in user's account.
- User reports for discussions, replies, reviews and collections, plus an auditable administrator resolution workflow.
- In-product notifications for discussion replies and newly approved revisions of subscribed plugins.
- Global review and workshop activity feeds backed by persisted community events.
- Community governance in the administration console, including content filters, report queues and live presence metrics.

### Changed

- User collections now have explicit private/public visibility and remain private until deliberately published.
- Community routes are reload-safe in the static preview and production routing model.
- Administration layouts now remain within a 390px mobile viewport while preserving scrollable data tables.

### Security

- Presence identifiers are held in memory and never persisted as raw browser identifiers; only five-minute aggregate snapshots are stored.
- Discussion content remains plain text, anonymous presence token issuance is rate-limited, and automated clients are excluded from live counts.
- Every community moderation and report-resolution action records its reason and request context in the audit log.

## [1.1.0] - 2026-08-14

### Added

- Internal, shareable plugin detail routes with explicit GitHub handoff.
- Real community review summaries bound to the currently published plugin revision.
- User-facing favorite, subscription, collection and device-session management.
- Faceted catalog search across kind, surface, topic, author, language and license.
- Application version reporting in health endpoints and browser surfaces.

### Changed

- The production storefront now renders approved, structurally verified DSH Bundles directly from the Marketplace API.
- Collections support transactional updates and ordered membership.
- Public catalog responses expose dynamic community statistics and declared dependency resolution.

### Security

- Unsupported installation, author-follow, award and discussion actions no longer report simulated success.
- Subscription is explicitly presented as an account relationship, not local code installation.
- Plugin detail pages preserve the distinction between structural verification and security review.
