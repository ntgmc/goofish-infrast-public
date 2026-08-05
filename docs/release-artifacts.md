# Public release artifact verification

The `main` quality workflow publishes `public.tgz` only after generating a
candidate changelog bound to the build SHA, verifying every staged file, and
starting a clean runtime dependency check from the archive. The archive
contains `package.json`, `package-lock.json`, and `release-sbom.cdx.json` so a
rollback uses the same locked production dependency graph as the build.

Do not trust `public.tgz.sha256` by itself because it is uploaded through the
same channel as the archive. Before deployment, verify GitHub's OIDC-backed
artifact attestation against this repository, then verify the local checksum:

```bash
gh attestation verify public.tgz --repo ntgmc/goofish-infrast-public
sha256sum --check public.tgz.sha256
```

After extraction, require Node 24 and npm 11, install only production
dependencies, and run the packaged smoke check before migration or traffic
switching:

```bash
npm ci --omit=dev
node scripts/check-release-runtime.mjs .
```

`build-manifest.json` records `deployable: false` when the public fallback
efficiency dataset was used. Such an archive is a reproducible demo/SDK build,
not a production deployment candidate, even when its hashes and attestation
are valid.

After the verified artifact is deployed, the public changelog is reachable,
traffic has switched, and the production readiness endpoint succeeds, run the
packaged idempotent confirmation command from the deployment job:

```bash
PUBLIC_APP_URL=https://maatool.com npm run release:confirm-production
```

The deployment environment must inject `WEBSITE_RELEASE_CONFIRMATION_TOKEN`
from its secret manager before running the command. The command derives the
release version from `/api/health/ready`, rejects
frontend/backend version drift, and creates the `release.published` event that
the QQ Bot polls. A first confirmation returns `created`; a deployment retry
returns `already confirmed`. Do not run this command from artifact creation,
pull-request validation, staging, or preview jobs.
