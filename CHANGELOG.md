## CHANGELOG

### [1.0.1] - 2026-02-16

#### Added
- Added tests directory with API test scripts
- Added `tests/test-todoist-api.js` - Basic API test script
- Added `tests/test-rest-api-full.mjs` - Full REST API test script (29 test cases)

#### Fixed
- **REST API Migration (v9 → v1)**: Updated `src/todoistRestAPI.ts` to handle new pagination format
  - `GetActiveTasks()`: Now returns `result.results` instead of raw result
  - `GetAllProjects()`: Now returns `result.results` instead of raw result
- **Build Configuration**: Updated `esbuild.config.mjs` to handle Node.js built-in modules in new `@doist/todoist-api-typescript` library (v6.5.0)
  - Added `node:assert`, `node:async_hooks`, `node:buffer`, `node:console`, `node:crypto`, `node:dns`, `node:diagnostics_channel`, `node:events`, `node:fs`, `node:http`, `node:https`, `node:net`, `node:path`, `node:perf_hooks`, `node:querystring`, `node:stream`, `node:string_decoder`, `node:timers`, `node:tls`, `node:url`, `node:util`, `node:util/types`, `node:worker_threads`, `node:zlib`

#### Changed
- **Library Update**: `@doist/todoist-api-typescript` upgraded from v2.1.2 to v6.5.0

#### Known Issues
- Sync API (v9 → v1) migration not yet implemented
- TypeScript compilation errors due to library version incompatibility with TypeScript 4.7.4 (use `npm run build-without-tsc` for now)

---

### prelease [1.0.38] - 2023-06-09

https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian/releases/tag/v1.0.38-beta

- New feature
    - 1.0.38 beta now supports date formats for tasks.
    - Todoist task link is added.

### prelease [1.0.37] - 2023-06-05

https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian/releases/tag/v1.0.37-beta

- New feature
    - Two-way automatic synchronization, no longer need to manually click the sync button.
    - Full vault sync option, automatically adding `#todoist` to all tasks.
    - Notes/comments one-way synchronization from Todoist to Obsidian.
- Bug fix
    - Fixed the bug of time zone conversion.
    - Removed the "#" from the Todoist label.
    - Update the obsidian link in Todoist after moving or renaming a file.
