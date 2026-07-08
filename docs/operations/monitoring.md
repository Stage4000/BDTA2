# Monitoring Runbook

## Required Checks
- `GET /health` for the API runtime.
- `GET /health` for the web runtime.
- Job worker heartbeat and queue-depth monitoring.
- Error-rate and latency monitoring for booking, portal, admin, payments, callbacks, and email processing.

## Launch Window
1. Watch health endpoints continuously during cutover.
2. Confirm request throughput and queue consumption remain healthy.
3. Confirm screenshot, smoke, and migration validation artifacts are archived.

## Alerts
- API or web health endpoint failure.
- Job queue backlog growth beyond the launch threshold.
- Elevated 5xx rate.
- Payment callback failures.
- Email outbox or inbound processing failures.
