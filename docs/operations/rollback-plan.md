# Rollback Plan

## Trigger Conditions
- Critical booking, portal, admin, payments, or authentication regression after cutover.
- Unrecoverable migration validation mismatch.
- Sustained production incident that cannot be mitigated safely inside the TypeScript runtime.

## Immediate Response
1. Freeze write traffic to the TypeScript API and web runtimes.
2. Stop background worker polling so no new jobs mutate state during rollback.
3. Preserve the current incident timestamp, request IDs, and affected client/account examples.

## Rollback Procedure
1. Restore the last known-good database snapshot taken immediately before cutover.
2. Repoint production traffic to the legacy PHP platform.
3. Disable the TypeScript API, web, and jobs runtimes.
4. Verify public booking, portal login, admin login, payments, and reminder processing on the legacy platform.

## Data Reconciliation
- Compare pre-cutover and post-rollback row counts for clients, bookings, invoices, quotes, contracts, forms, sessions, and queued jobs.
- Export any write activity that occurred after cutover and before rollback for manual replay review.

## Exit Criteria
- Legacy PHP production traffic is restored.
- Booking, portal, admin, and payment smoke checks pass on the legacy platform.
- Stakeholders are notified that rollback is complete and the TypeScript launch remains blocked pending remediation.
