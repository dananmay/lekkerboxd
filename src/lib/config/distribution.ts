export type DistributionChannel = 'store' | 'github';

declare const __LEKKERBOXD_CHANNEL__: string;

export function getDistributionChannel(): DistributionChannel {
  return __LEKKERBOXD_CHANNEL__ === 'github' ? 'github' : 'store';
}

export function isGithubDistribution(): boolean {
  return getDistributionChannel() === 'github';
}

export function isStoreDistribution(): boolean {
  return getDistributionChannel() === 'store';
}

