# Changelog

All notable changes to DSH Creative Workshop are recorded here.

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
