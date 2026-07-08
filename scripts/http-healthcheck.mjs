const [url] = process.argv.slice(2);

if (!url) {
  process.stderr.write("Usage: node scripts/http-healthcheck.mjs <url>\n");
  process.exit(1);
}

try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    process.stderr.write(`Healthcheck failed with status ${response.status} for ${url}\n`);
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
