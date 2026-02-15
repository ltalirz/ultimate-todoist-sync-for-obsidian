## CHANGELOG

### [1.0.2] - 2026-02-16

#### Added
- Added comprehensive operation logging system (`src/logOperation.ts`)
  - Tracks 30+ log action types including task operations, file operations, cache operations, and Todoist API operations
  - Persistent log storage in plugin settings
  - Log viewing modal in settings
- Added bidirectional sync module split
  - `src/obsidianToTodoist.ts` - Handles sync from Obsidian to Todoist
  - `src/todoistToObsidian.ts` - Handles sync from Todoist to Obsidian
  - `src/syncModule.ts` - Refactored to orchestrate bidirectional sync
- Added automatic file backup before modifications (`src/backupOperation.ts`)
  - Backs up files to `.todoist-backups/` directory
  - Configurable backup retention
- Added conflict detection and resolution for rebuild cache (`src/conflictModal.ts`)
  - Interactive modal for resolving content and status conflicts
  - Options: keep Obsidian, keep Todoist, or skip
- Added comprehensive `checkDatabase` function
  - Detects 9 types of issues: missing files, missing metadata, orphaned tasks, duplicate tasks, invalid task IDs, content mismatches, status mismatches, empty metadata, and tasks in files but not in cache
  - Scans entire vault to find missing cache entries

#### Fixed
- Fixed checkbox regex bug (`\d+` → `\w+` to support string IDs)
- Fixed taskParser.ts regex inconsistencies
- Fixed duplicate module initialization in initializePlugin()
- Fixed AddTask date handling bug (was converting dueDatetime instead of dueDate)
- Fixed unused imports and variables in main.ts
- Improved rebuildCache with checkbox status detection and completion status comparison

---

### [1.0.1] - 2026-02-16

#### Added
- Added tests directory with API test scripts
- Added `tests/test-todoist-api.js` - Basic API test script
- Added `tests/test-rest-api-full.mjs` - Full REST API test script (29 test cases)
- Added `tests/test-sync-api.js` - Basic Sync API test script
- Added `tests/test-sync-api-full.js` - Full Sync API test script (26 test cases)

#### Fixed
- **REST API Migration (v9 → v1)**: Updated `src/todoistRestAPI.ts` to handle new pagination format
  - `GetActiveTasks()`: Now returns `result.results` instead of raw result
  - `GetAllProjects()`: Now returns `result.results` instead of raw result
- **Sync API Migration (v9 → v1)**: Updated `src/todoistSyncAPI.ts` to use new API endpoints
  - `getAllResources()`: Changed URL to `/api/v1/sync`
  - `getUserResource()`: Changed URL to `/api/v1/sync`
  - `updateUserTimezone()`: Changed URL to `/api/v1/sync`
  - `getAllActivityEvents()`: Changed to GET `/api/v1/activities`, returns `{ events: [] }` format
  - `getCompletedItemsActivity()`: Changed to GET `/api/v1/activities?event_type=completed`
  - `getUncompletedItemsActivity()`: Changed to GET `/api/v1/activities?event_type=uncompleted`
  - `getUpdatedItemsActivity()`: Changed to GET `/api/v1/activities?event_type=updated`
  - `getProjectsActivity()`: Changed to GET `/api/v1/activities?object_type=project`
  - Fixed null check for `extra_data.client` in `getNonObsidian*` methods
- **Build Configuration**: Updated `esbuild.config.mjs` to handle Node.js built-in modules in new `@doist/todoist-api-typescript` library (v6.5.0)
  - Added `node:assert`, `node:async_hooks`, `node:buffer`, `node:console`, `node:crypto`, `node:dns`, `node:diagnostics_channel`, `node:events`, `node:fs`, `node:http`, `node:https`, `node:net`, `node:path`, `node:perf_hooks`, `node:querystring`, `node:stream`, `node:string_decoder`, `node:timers`, `node:tls`, `node:url`, `node:util`, `node:util/types`, `node:worker_threads`, `node:zlib`

#### Changed
- **Library Update**: `@doist/todoist-api-typescript` upgraded from v2.1.2 to v6.5.0

#### Known Issues
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
