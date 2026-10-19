# README and documentation placement

Read this guide when editing a README or adding/changing feature, configuration,
deployment, or operational documentation. The root README is a compact project
entrypoint; detailed explanations belong in the document that owns the topic.

## Root README scope

Keep `README.md` in Chinese, with a short introduction and these sections:

| Content | Scope |
| --- | --- |
| Project overview | One sentence explaining the application and its purpose |
| Technology stack | A compact table of the main technologies and current versions |
| Local development | Runtime/package-manager requirements, prerequisites, installation and frontend/backend startup commands, default local URLs |
| Common commands | A small set of build, preview, test, and check commands |
| Essential links and attribution | Contribution, security reporting, open-source boundary, license, and third-party attribution |

Mention required local services and configuration file locations briefly. Keep
environment variable lists, configuration examples, deployment steps, precautions,
API contracts, feature behavior, troubleshooting, and change/review histories out
of the README. Keep headings shallow and avoid an exhaustive command catalog or
an expanding documentation index.

## Where new explanations go

Use an existing document that owns the topic before creating another one:

| Topic | Canonical location |
| --- | --- |
| Feature behavior and limitations | The relevant feature document under `docs/` |
| Environment variables, external services, deployment, and troubleshooting | The relevant configuration, integration, or operations document under `docs/` |
| Release artifacts and production release confirmation | [release-artifacts.md](release-artifacts.md) |
| Database schema and migrations | [database-migration.md](database-migration.md) |
| Backup and recovery | [disaster-recovery.md](disaster-recovery.md) |
| QQ Bot integration | [qqbot-handoff.md](qqbot-handoff.md) |
| Validation commands and completion requirements | [agent-validation.md](agent-validation.md) |
| Contribution, security reporting, and public/private scope | [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), [OPEN_SOURCE_BOUNDARY.md](../OPEN_SOURCE_BOUNDARY.md) |

If no document owns the topic, create one focused `docs/<topic>.md` file. Keep each
explanation in one canonical location and use links instead of copying it. Add a
README link only when it is essential for onboarding, with a short description.
Add a task-triggered entry in [AGENTS.md](../AGENTS.md) when future agents need to
read the document for that kind of work; keep detailed rules in the topic file.

## Updating and verifying documentation

- A feature, API, configuration, or deployment change does not automatically
  require a README addition. Update its topic document first; edit the README only
  when its permitted content changes.
- Verify technology versions and runtime requirements against `package.json`
  and `pnpm-lock.yaml`; verify commands and local URLs against scripts and
  implementation. Document current behavior without proposed or guessed settings.
- Check links, headings, code fences, and the full diff for duplicated or misplaced
  content. Follow [agent-validation.md](agent-validation.md), including
  `git diff --check`, `pnpm run check:architecture`, and `pnpm run check:dead-code`.
