import { createReleaseValidationState, releaseValidationAdminCredentials, releaseValidationPortalCredentials } from '../dist/apps/release/src/fixtures.js';
import { createHttpApiServer } from '../dist/apps/api/src/server.js';
import { createHttpWebServer } from '../dist/apps/web/src/server.js';
import { createUnifiedPlatformServer } from '../dist/apps/platform/src/server.js';
import { createInMemoryApiDependencies, createInMemorySessionStore } from '../dist/packages/infrastructure/src/index.js';

const state = createReleaseValidationState();
const dependencies = createInMemoryApiDependencies(state);
const sessionStore = createInMemorySessionStore(state);
const apiServer = createHttpApiServer({ dependencies, sessionStore });
const webServer = createHttpWebServer({ dependencies, sessionStore });
const server = createUnifiedPlatformServer({ apiServer, webServer });
const host = '127.0.0.1';
const port = 4311;
server.listen(port, host, () => {
  console.log(JSON.stringify({
    ready: true,
    url: `http://${host}:${port}`,
    portalLogin: releaseValidationPortalCredentials,
    adminLogin: releaseValidationAdminCredentials
  }));
});
for (const signal of ['SIGINT','SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
