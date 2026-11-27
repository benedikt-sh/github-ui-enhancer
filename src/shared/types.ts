export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export type RepoVisibility = 'public' | 'private' | 'internal';

export interface RepoSummary extends RepoRef {
  /** GraphQL node id, stable across renames. */
  readonly id: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly visibility: RepoVisibility;
  readonly archived: boolean;
  readonly fork: boolean;
  readonly defaultBranch: string;
  /** ISO 8601, null for repositories without any push. */
  readonly pushedAt: string | null;
  readonly url: string;
}

export interface Actor {
  readonly login: string;
  readonly avatarUrl: string;
  readonly url: string;
}

export interface LabelInfo {
  readonly name: string;
  /** Hex color without leading "#", as delivered by the API. */
  readonly color: string;
}

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required';

/** Combined commit status of the head commit (GraphQL `StatusState`). */
export type CheckState = 'success' | 'failure' | 'pending' | 'error' | 'expected';

export interface PullRequestItem {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: RepoRef;
  readonly author: Actor | null;
  readonly state: 'open' | 'closed' | 'merged';
  readonly isDraft: boolean;
  readonly reviewDecision: ReviewDecision | null;
  readonly checkState: CheckState | null;
  readonly labels: readonly LabelInfo[];
  readonly commentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueItem {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: RepoRef;
  readonly author: Actor | null;
  readonly state: 'open' | 'closed';
  readonly stateReason: 'completed' | 'not_planned' | 'reopened' | 'duplicate' | null;
  readonly assignees: readonly Actor[];
  readonly labels: readonly LabelInfo[];
  readonly commentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowRunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending';

export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure';

export interface WorkflowRunItem {
  readonly id: number;
  readonly workflowName: string;
  readonly displayTitle: string;
  readonly runNumber: number;
  readonly runAttempt: number;
  readonly event: string;
  readonly status: WorkflowRunStatus;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly branch: string | null;
  readonly headSha: string;
  readonly actor: Actor | null;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runStartedAt: string | null;
}

export const REPO_ACTIVITY_KINDS = [
  'push',
  'pull_request',
  'review',
  'issue',
  'comment',
  'create',
  'release',
  'other',
] as const;

export type RepoActivityKind = (typeof REPO_ACTIVITY_KINDS)[number];

/** A repository the user was active in, aggregated from the user's own events. */
export interface RecentRepoItem {
  readonly repo: RepoRef;
  readonly url: string;
  readonly lastActivityAt: string;
  readonly lastActivity: RepoActivityKind;
  /** Branch of the latest push or created branch, null for other activities. */
  readonly branch: string | null;
  /** Number of matching events within the window GitHub keeps (at most 90 days). */
  readonly activityCount: number;
}

export interface BranchItem {
  readonly name: string;
  readonly protected: boolean;
}
