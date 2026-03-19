## CHANGELOG

### [2.0.3] - 2026-03-20

#### Fixed
- Add logging to 22 previously silent early returns across the sync pipeline
- Sync lock timeouts, disabled-task skips, missing sync targets, and parser failures are now logged to the operation log for troubleshooting
- New log event types: `SYNC_LOCK_TIMEOUT`, `SYNC_DISABLED_SKIP`, `SYNC_TARGET_MISSING`, `TASK_PARSE_FAILED`

---

### [2.0.2] - 2026-03-17

#### Fixed
- Full Vault Sync: new tasks are now created only when the cursor leaves the line, preventing the "typing hijack" bug where every keystroke triggered task creation

---

### [2.0.0] - 2026-03-15

#### Added
- Sync direction controls: independently enable/disable Obsidian→Todoist and Todoist→Obsidian
- Excluded folders: tree UI to select folders excluded from Full Vault Sync
- Full vault sync now scans all vault files on each sync cycle
- Automatic exclusion of template folders, hidden folders, and plugin storage

#### Changed
- Todoist API migrated from v9 to v1, library upgraded to v6.5.0
- Data architecture simplified: Todoist API as single source of truth, removed local task cache
- Backup files now use `.md.bak` extension to prevent Obsidian link pollution
- Priority and labels/tags sync is now fully bidirectional
- Database checker rewritten with three-way data consistency checks

#### Fixed
- Stability improvements for Full Vault Sync

---

### [1.0.4] - 2026-02-17

#### Added
- **Three-way sync direction controls**: Added two new settings for granular sync control
  - `obsidianToTodoistEnabled` (default: true) - Enable/disable Obsidian → Todoist sync
  - `todoistToObsidianEnabled` (default: false) - Enable/disable Todoist → Obsidian sync
  - Both directions are independently controllable via new UI toggles in settings
  - Sync status display now shows direction states
- **Full syncData persistence**: Added `syncDataCache` field to settings to store complete Todoist API response
  - All API data (projects, items, sections, labels, notes, user, etc.) is now persisted
  - Plugin startup loads from cache first, reducing API calls
  - Data is saved to cache after full sync and incremental sync

#### Changed
- **Removed syncToken from settings**: Token now only stored in memory within syncDataCache
  - Read from `this.syncData?.sync_token` instead of `settings.syncToken`
- **Improved mergeSyncData**: Now merges all API response fields dynamically instead of hardcoded fields
- **databaseChecker completely rewritten**: 
  - Now checks 8 combinations of 3 data sources (Vault, Todoist, taskFileMapping)
  - New issue types: mapping_file_not_found, mapping_task_not_in_todoist, mapping_orphan, vault_task_no_mapping, line_number_mismatch
  - Report format updated: shows data source combinations table first, then detailed issues by type

#### Fixed
- **rebuildCache refactored**: Updated to use new architecture with taskFileMapping

#### Tests
- Added comprehensive test suite: `tests/sync-api/test-todoist-sync-api-full.mjs`

---

### [1.0.3] - 2026-02-17

#### Changed
- **Major Refactoring: Simplified Data Architecture**
  - Removed `todoistTasksData` from settings (was storing tasks/projects/events in persistent storage)
  - Added `taskFileMapping` to settings (stores taskId → {filePath, lineNumber} mapping only)
  - Now using `syncData` (in-memory from Todoist API) as single source of truth for tasks/projects
  - Todoist API is now the primary data source instead of local cache

#### Refactored Files
- `src/settings.ts`: Removed `todoistTasksData` interface, added `taskFileMapping` interface
- `src/todoistSyncAPI.ts`: 
  - Modified `GetAllProjects()`, `GetTaskById()`, `GetActiveTasks()` to read from `syncData` with fallback to full sync
  - Added `getProjectById()`, `getProjectByName()` methods for project lookups
  - Added `getSyncData()` public method to access in-memory sync data
- `src/cacheOperation.ts`:
  - Added 4 new taskFileMapping methods: `getTaskFileMapping()`, `setTaskFileMapping()`, `deleteTaskFileMapping()`, `getAllTaskFileMappings()`
  - Deprecated all old cache methods (made them no-ops): `loadTasksFromCache`, `saveTasksToCache`, `appendTaskToCache`, `closeTaskToCacheByID`, `reopenTaskToCacheByID`, etc.
  - Updated `getDefaultProjectNameForFilepath()` to use todoistSyncAPI
- `src/obsidianToTodoist.ts`: Replaced all cacheOperation calls with taskFileMapping or removed them
- `src/fileOperation.ts`: Replaced all `loadTaskFromCacheyID()` calls with `getTaskFileMapping()` + `GetTaskById()`
- `src/taskParser.ts`: Replaced cache methods with todoistSyncAPI methods
- `src/databaseChecker.ts`: Uses `syncData.items` + `taskFileMapping` instead of `todoistTasksData.tasks`
- `src/modal.ts`: Uses `todoistSyncAPI.getSyncData().projects` instead of `todoistTasksData.projects`
- `src/todoistToObsidian.ts`: Simplified to use taskFileMapping, removed event tracking calls

#### Notes
- Events (todoist → obsidian sync) are temporarily ignored to simplify one-way sync first
- This refactoring reduces data duplication and ensures Todoist is the single source of truth

---

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
- Added comprehensive `checkDatabase` function with 3-way data comparison
  - **Three data sources**: Vault files, local Cache, and Todoist API
  - **16 types of issue detection**:
    - `task_deleted_in_todoist`: Task exists in Vault and Cache but deleted in Todoist
    - `missing_in_cache`: Task exists in Vault and Todoist but not in local cache
    - `new_task_not_synced`: Task in Vault not synced to Todoist and not in cache
    - `file_reference_missing`: Task in Cache and Todoist but Vault file reference missing
    - `orphaned_in_cache`: Task in Cache but not in Vault and deleted in Todoist
    - `task_not_in_vault`: Task in Todoist but not in any Vault file
    - `content_mismatch`: Content differs between Vault and Todoist
    - `cache_content_outdated`: Cache content is outdated compared to Todoist
    - `status_mismatch`: Completion status differs between Vault and Todoist
    - `cache_status_outdated`: Cache status is outdated compared to Todoist
    - `duedate_mismatch`: Due date differs between Cache and Todoist
    - `duplicate_task`: Same task ID appears in multiple files
    - `priority_mismatch`: Priority differs between Cache and Todoist
    - `label_mismatch`: Labels differ between Vault and Todoist
    - `project_mismatch`: Project differs between Cache and Todoist
  - Generates detailed markdown report with task information (ID, content, file, line, due date, priority, status)
  - Report saved to `.todoist-reports/` folder

#### Fixed
- Fixed checkbox regex bug (`\d+` → `\w+` to support string IDs)
- Fixed taskParser.ts regex inconsistencies
- Fixed duplicate module initialization in initializePlugin()
- Fixed AddTask date handling bug (was converting dueDatetime instead of dueDate)
- Fixed unused imports and variables in main.ts
- Improved rebuildCache with checkbox status detection and completion status comparison
- Fixed `getPluginPath()` method error - replaced `getBasePath()` with `vault.configDir` for better compatibility
- Replaced `fetch()` with Obsidian's `requestUrl()` for all Todoist API calls to fix CORS issues and ensure proper `X-Todoist-Client` header is sent

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
