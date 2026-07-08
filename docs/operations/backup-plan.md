# Backup Plan

## Database
- Take a full MySQL snapshot immediately before launch.
- Retain point-in-time recovery capability for the production database.
- Capture a second validation snapshot after launch smoke tests complete.

## File Assets
- Back up pet files and any runtime-generated uploads before cutover.
- Verify restore access for the backing storage location used by the TypeScript runtime.

## Retention
- Preserve the pre-cutover snapshot until launch is declared stable.
- Keep daily database backups and routine file backups according to the production retention policy.

## Restore Drill
1. Restore the pre-cutover snapshot into a non-production environment.
2. Validate clients, bookings, invoices, quotes, contracts, forms, packages, credits, and pet files.
3. Record restore duration and any manual steps required.
