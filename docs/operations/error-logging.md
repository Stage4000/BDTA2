# Error Logging Configuration

## Runtime Logging
- API and web runtimes emit request IDs and structured access logs.
- API, web, and jobs runtimes emit structured error events on unexpected failures.
- Migration CLI exits non-zero when preflight or cutover execution fails.

## Operational Expectations
- Capture request ID, runtime name, route, status code, and latency for every request.
- Preserve structured stderr/stdout output from API, web, jobs, and migrate processes.
- Route production logs to the configured log sink before launch.

## Incident Use
1. Identify the failing request or worker cycle by request ID or job ID.
2. Correlate the error with callback logs, queue state, and recent deployment changes.
3. Attach the relevant log excerpts to the launch incident or rollback record.
