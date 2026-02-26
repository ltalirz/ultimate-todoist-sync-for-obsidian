export type DerivedTaskStatus = 'active' | 'nonActive' | 'conflicted' | 'issue';
export type TaskIssueState = 'open' | 'resolved' | 'ignored';
export type TaskIssueSeverity = 'low' | 'medium' | 'high';
export type TaskIssueSource = 'database_checker' | 'runtime';

export interface TaskIssueEntryLike {
	state?: TaskIssueState;
	severity?: TaskIssueSeverity;
	source?: TaskIssueSource;
	detectedAt?: number;
	lastSeenAt?: number;
	details?: string;
	expected?: string;
	actual?: string;
	manualAction?: string;
}

export type TaskIssueRecordLike = Record<string, TaskIssueEntryLike>;

export interface OpenIssueEntry {
	issueType: string;
	details?: string;
	expected?: string;
	actual?: string;
	manualAction?: string;
}

export type ProblemTaskDisplayType = DerivedTaskStatus | 'staleLink';

export interface DerivedTaskProblemView {
	status: DerivedTaskStatus;
	syncEnabled: boolean;
	openIssueTypes: string[];
	openIssues: OpenIssueEntry[];
	hasStaleLinkIssue: boolean;
	displayType: ProblemTaskDisplayType;
}

export const CONFLICT_ISSUE_TYPE_KEYS = new Set<string>([
	'sync_content_mismatch',
	'sync_completion_mismatch',
	'sync_due_mismatch',
	'sync_labels_mismatch',
	'sync_priority_mismatch',
	'sync_project_mismatch',
	'task_duplicate_candidate',
]);

export const NON_ACTIVE_ISSUE_TYPE_KEYS = new Set<string>(['task_marked_nonactive']);

const TASK_ISSUE_TYPE_VALUES = new Set<string>([
	'sync_content_mismatch',
	'sync_completion_mismatch',
	'sync_due_mismatch',
	'sync_labels_mismatch',
	'sync_priority_mismatch',
	'sync_project_mismatch',
	'todoist_link_stale',
	'todoist_task_missing',
	'vault_task_missing',
	'mapping_missing_for_task',
	'mapping_pointer_stale',
	'mapping_file_missing',
	'mapping_target_missing_in_todoist',
	'mapping_orphaned',
	'task_unsynced_new',
	'task_requires_review',
	'task_marked_nonactive',
	'task_duplicate_candidate',
	'issue_source_unconfirmed',
	'issue_unclassified',
]);

const LEGACY_TASK_ISSUE_TYPE_ALIASES: Record<string, string> = {
	label_mismatch: 'sync_labels_mismatch',
	labelsMismatch: 'sync_labels_mismatch',
	dueDateMismatch: 'sync_due_mismatch',
	duedateMismatch: 'sync_due_mismatch',
	priorityMismatch: 'sync_priority_mismatch',
	projectMismatch: 'sync_project_mismatch',
	contentMismatch: 'sync_content_mismatch',
	statusMismatch: 'sync_completion_mismatch',
	staleTodoistLink: 'todoist_link_stale',
	taskNonActive: 'task_marked_nonactive',
	taskIssue: 'task_requires_review',
	unknownIssue: 'issue_unclassified',
	duplicateTask: 'task_duplicate_candidate',
	content_mismatch: 'sync_content_mismatch',
	status_mismatch: 'sync_completion_mismatch',
	due_date_mismatch: 'sync_due_mismatch',
	labels_mismatch: 'sync_labels_mismatch',
	priority_mismatch: 'sync_priority_mismatch',
	project_mismatch: 'sync_project_mismatch',
	stale_todoist_link: 'todoist_link_stale',
	task_deleted_in_todoist: 'todoist_task_missing',
	task_not_in_vault: 'vault_task_missing',
	vault_task_no_mapping: 'mapping_missing_for_task',
	mapping_file_not_found: 'mapping_file_missing',
	mapping_task_not_in_todoist: 'mapping_target_missing_in_todoist',
	mapping_orphan: 'mapping_orphaned',
	new_task_not_synced: 'task_unsynced_new',
	task_issue: 'task_requires_review',
	task_nonactive: 'task_marked_nonactive',
	duplicate_task: 'task_duplicate_candidate',
	unknown_issue: 'issue_unclassified',
};

export function normalizeTaskIssueTypeKey(issueType: string): string {
	if (TASK_ISSUE_TYPE_VALUES.has(issueType)) {
		return issueType;
	}

	return LEGACY_TASK_ISSUE_TYPE_ALIASES[issueType] || 'issue_unclassified';
}

export function normalizeDerivedTaskStatus(status: string | undefined): DerivedTaskStatus {
	if (status === 'active' || status === 'nonActive' || status === 'conflicted' || status === 'issue') {
		return status;
	}
	return 'active';
}

export function getOpenIssueEntries(issues: TaskIssueRecordLike | undefined): OpenIssueEntry[] {
	if (!issues || Object.keys(issues).length === 0) return [];

	const normalizedIssues = new Map<string, OpenIssueEntry>();
	for (const [rawIssueType, issue] of Object.entries(issues)) {
		if (issue?.state !== 'open') continue;
		const issueType = normalizeTaskIssueTypeKey(rawIssueType);
		if (!normalizedIssues.has(issueType)) {
			normalizedIssues.set(issueType, {
				issueType,
				details: issue.details,
				expected: issue.expected,
				actual: issue.actual,
				manualAction: issue.manualAction,
			});
		}
	}

	return Array.from(normalizedIssues.values());
}

export function deriveTaskStatusFromIssueEntries(
	issues: TaskIssueRecordLike | undefined,
	fallbackStatus: DerivedTaskStatus = 'active'
): DerivedTaskStatus {
	const normalizedFallbackStatus = normalizeDerivedTaskStatus(fallbackStatus);
	if (!issues || Object.keys(issues).length === 0) return normalizedFallbackStatus;

	const normalizedOpenIssueTypes = getOpenIssueEntries(issues).map(issue => issue.issueType);

	if (normalizedOpenIssueTypes.length === 0) return 'active';
	if (normalizedOpenIssueTypes.some(issueType => CONFLICT_ISSUE_TYPE_KEYS.has(issueType))) return 'conflicted';
	if (normalizedOpenIssueTypes.some(issueType => NON_ACTIVE_ISSUE_TYPE_KEYS.has(issueType))) return 'nonActive';
	return 'issue';
}

export function deriveTaskProblemViewFromEntry(
	entry: { status?: string; issues?: TaskIssueRecordLike } | undefined,
	options?: { hasSyntheticStaleLinkIssue?: boolean; fallbackStatus?: DerivedTaskStatus }
): DerivedTaskProblemView {
	const fallbackStatus = normalizeDerivedTaskStatus(options?.fallbackStatus ?? entry?.status);
	const openIssues = getOpenIssueEntries(entry?.issues);
	const openIssueTypes = openIssues.map(issue => issue.issueType);
	const status = deriveTaskStatusFromIssueEntries(entry?.issues, fallbackStatus);
	const hasStaleLinkIssue = !!options?.hasSyntheticStaleLinkIssue || openIssueTypes.includes('todoist_link_stale');
	const displayType: ProblemTaskDisplayType = status === 'conflicted' || status === 'nonActive'
		? status
		: (hasStaleLinkIssue ? 'staleLink' : status);

	return {
		status,
		syncEnabled: status === 'active',
		openIssueTypes,
		openIssues,
		hasStaleLinkIssue,
		displayType,
	};
}

export function reconcileTaskEntryDerivedState<T extends { status?: DerivedTaskStatus; syncEnabled?: boolean; issues?: TaskIssueRecordLike }>(
	entry: T,
	fallbackStatus?: DerivedTaskStatus
): { entry: T; changed: boolean; status: DerivedTaskStatus; syncEnabled: boolean } {
	const normalizedFallbackStatus = normalizeDerivedTaskStatus(fallbackStatus ?? entry.status);
	const nextStatus = deriveTaskStatusFromIssueEntries(entry.issues, normalizedFallbackStatus);
	const nextSyncEnabled = nextStatus === 'active';

	let changed = false;
	if (entry.status !== nextStatus) {
		entry.status = nextStatus;
		changed = true;
	}
	if (entry.syncEnabled !== nextSyncEnabled) {
		entry.syncEnabled = nextSyncEnabled;
		changed = true;
	}

	return {
		entry,
		changed,
		status: nextStatus,
		syncEnabled: nextSyncEnabled,
	};
}

export function upsertTaskIssueEntry(
	issues: TaskIssueRecordLike | undefined,
	issueType: string,
	issue: {
		state?: TaskIssueState;
		severity?: TaskIssueSeverity;
		source?: TaskIssueSource;
		details?: string;
		expected?: string;
		actual?: string;
		manualAction?: string;
	},
	now = Date.now()
): { issues: TaskIssueRecordLike; normalizedIssueType: string } {
	const normalizedIssues: TaskIssueRecordLike = {};
	if (issues && typeof issues === 'object' && !Array.isArray(issues)) {
		for (const [existingIssueType, existingIssue] of Object.entries(issues)) {
			normalizedIssues[normalizeTaskIssueTypeKey(existingIssueType)] = { ...existingIssue };
		}
	}

	const normalizedIssueType = normalizeTaskIssueTypeKey(issueType);
	const previous = normalizedIssues[normalizedIssueType];
	normalizedIssues[normalizedIssueType] = {
		state: issue.state ?? 'open',
		severity: issue.severity ?? 'medium',
		source: issue.source ?? 'runtime',
		detectedAt: typeof previous?.detectedAt === 'number' ? previous.detectedAt : now,
		lastSeenAt: now,
		details: issue.details,
		expected: issue.expected,
		actual: issue.actual,
		manualAction: issue.manualAction,
	};

	return {
		issues: normalizedIssues,
		normalizedIssueType,
	};
}

export function resolveTaskIssuesByType(
	issues: TaskIssueRecordLike | undefined,
	shouldResolve: (issueType: string) => boolean,
	now = Date.now()
): { issues: TaskIssueRecordLike | undefined; changed: boolean } {
	if (!issues || typeof issues !== 'object' || Array.isArray(issues)) {
		return { issues: undefined, changed: false };
	}

	let changed = false;
	const normalizedIssues: TaskIssueRecordLike = {};

	for (const [rawIssueType, issueValue] of Object.entries(issues)) {
		const issueType = normalizeTaskIssueTypeKey(rawIssueType);
		const issueRecord: TaskIssueEntryLike = { ...issueValue };
		if (issueRecord.state === 'open' && shouldResolve(issueType)) {
			issueRecord.state = 'resolved';
			issueRecord.lastSeenAt = now;
			changed = true;
		}
		if (rawIssueType !== issueType) changed = true;

		const existing = normalizedIssues[issueType];
		if (!existing) {
			normalizedIssues[issueType] = issueRecord;
			continue;
		}
		if (existing.state !== 'open' && issueRecord.state === 'open') {
			normalizedIssues[issueType] = issueRecord;
			changed = true;
		}
	}

	if (Object.keys(normalizedIssues).length === 0) {
		return { issues: undefined, changed: true };
	}

	return { issues: normalizedIssues, changed };
}

export function resolveOpenIssuesFromSourceNotSeen(
	issues: TaskIssueRecordLike | undefined,
	source: TaskIssueSource,
	seenIssueTypes: Set<string>,
	now = Date.now()
): { issues: TaskIssueRecordLike | undefined; changed: boolean } {
	if (!issues || typeof issues !== 'object' || Array.isArray(issues)) {
		return { issues: undefined, changed: false };
	}

	let changed = false;
	const normalizedIssues: TaskIssueRecordLike = {};

	for (const [rawIssueType, issueValue] of Object.entries(issues)) {
		const issueType = normalizeTaskIssueTypeKey(rawIssueType);
		const issueRecord: TaskIssueEntryLike = { ...issueValue };

		if (issueRecord.source === source && issueRecord.state === 'open' && !seenIssueTypes.has(issueType)) {
			issueRecord.state = 'resolved';
			issueRecord.lastSeenAt = now;
			changed = true;
		}

		if (rawIssueType !== issueType) changed = true;

		const existing = normalizedIssues[issueType];
		if (!existing) {
			normalizedIssues[issueType] = issueRecord;
			continue;
		}
		if (existing.state !== 'open' && issueRecord.state === 'open') {
			normalizedIssues[issueType] = issueRecord;
			changed = true;
		}
	}

	if (Object.keys(normalizedIssues).length === 0) {
		return { issues: undefined, changed: true };
	}

	return { issues: normalizedIssues, changed };
}
