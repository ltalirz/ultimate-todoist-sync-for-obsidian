export type DerivedTaskStatus = 'active' | 'nonActive' | 'conflicted' | 'issue';

export const CONFLICT_ISSUE_TYPE_KEYS = new Set<string>([
	'content_mismatch',
	'status_mismatch',
	'due_date_mismatch',
	'labels_mismatch',
	'priority_mismatch',
	'project_mismatch',
	'duplicate_task',
]);

export const NON_ACTIVE_ISSUE_TYPE_KEYS = new Set<string>(['task_nonactive']);

const TASK_ISSUE_TYPE_VALUES = new Set<string>([
	'content_mismatch',
	'status_mismatch',
	'due_date_mismatch',
	'labels_mismatch',
	'priority_mismatch',
	'project_mismatch',
	'stale_todoist_link',
	'task_deleted_in_todoist',
	'task_not_in_vault',
	'vault_task_no_mapping',
	'mapping_file_not_found',
	'mapping_task_not_in_todoist',
	'mapping_orphan',
	'new_task_not_synced',
	'task_issue',
	'task_nonactive',
	'duplicate_task',
	'unknown_issue',
]);

const LEGACY_TASK_ISSUE_TYPE_ALIASES: Record<string, string> = {
	label_mismatch: 'labels_mismatch',
	labelsMismatch: 'labels_mismatch',
	dueDateMismatch: 'due_date_mismatch',
	duedateMismatch: 'due_date_mismatch',
	priorityMismatch: 'priority_mismatch',
	projectMismatch: 'project_mismatch',
	contentMismatch: 'content_mismatch',
	statusMismatch: 'status_mismatch',
	staleTodoistLink: 'stale_todoist_link',
	taskNonActive: 'task_nonactive',
	taskIssue: 'task_issue',
	unknownIssue: 'unknown_issue',
	duplicateTask: 'duplicate_task',
};

export function normalizeTaskIssueTypeKey(issueType: string): string {
	if (TASK_ISSUE_TYPE_VALUES.has(issueType)) {
		return issueType;
	}

	return LEGACY_TASK_ISSUE_TYPE_ALIASES[issueType] || 'unknown_issue';
}

export function deriveTaskStatusFromIssueEntries(
	issues: Record<string, { state?: string }> | undefined,
	fallbackStatus: DerivedTaskStatus = 'active'
): DerivedTaskStatus {
	if (!issues || Object.keys(issues).length === 0) return fallbackStatus;

	const openIssueTypes = Object.entries(issues)
		.filter(([, issue]) => issue?.state === 'open')
		.map(([issueType]) => normalizeTaskIssueTypeKey(issueType));

	const normalizedOpenIssueTypes = Array.from(new Set(openIssueTypes));

	if (normalizedOpenIssueTypes.length === 0) return 'active';
	if (normalizedOpenIssueTypes.some(issueType => CONFLICT_ISSUE_TYPE_KEYS.has(issueType))) return 'conflicted';
	if (normalizedOpenIssueTypes.some(issueType => NON_ACTIVE_ISSUE_TYPE_KEYS.has(issueType))) return 'nonActive';
	return 'issue';
}
