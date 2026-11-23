import type { Job, Store } from './lib';

export interface FeedFilterOptions {
  q: string;
  roles: Job['role'][];
  tiers: Job['tier'][];
  hideAgency: boolean;
  showIntern: boolean;
  showClosed: boolean;
  hideTracked: boolean;
  source: 'all' | 'mcf' | 'company';
}

// Apply every visibility filter except "only new", so its badge and results
// are derived from exactly the same candidate jobs.
export function matchesFeedFilters(job: Job, filters: FeedFilterOptions, tracker: Store['tracker']): boolean {
  if (!filters.roles.includes(job.role)) return false;
  if (!filters.tiers.includes(job.tier)) return false;
  if (filters.hideAgency && job.flags.agency) return false;
  if (!filters.showIntern && job.flags.intern) return false;
  if (!filters.showClosed && job.closedAt) return false;
  if (filters.hideTracked && tracker[job.id]) return false;
  if (tracker[job.id]?.status === 'ignored' && !filters.showClosed) return false;
  if (filters.source === 'mcf' && job.source !== 'MyCareersFuture') return false;
  if (filters.source === 'company' && job.source === 'MyCareersFuture') return false;
  const q = filters.q.trim().toLowerCase();
  return !q || `${job.title} ${job.company} ${job.techs.join(' ')}`.toLowerCase().includes(q);
}

// "New" is when Radar first discovered a still-open job, not when its text
// was updated. The saved marker is advanced only by "Mark all seen".
export function isNewJob(job: Job, lastSeenAt: string | null): boolean {
  return Boolean(!job.closedAt && lastSeenAt && job.firstSeen > lastSeenAt);
}
