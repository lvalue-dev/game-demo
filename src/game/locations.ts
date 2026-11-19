import type { LocationDef } from './types.ts';

export const LOCATIONS: LocationDef[] = [
  { name: '편의점', quota: 16, escapeNeeded: 2, patrol: 1, vaultTech: 0 },
  { name: '전당포', quota: 21, escapeNeeded: 2, patrol: 1, vaultTech: 0 },
  { name: '보석상', quota: 26, escapeNeeded: 3, patrol: 1, vaultTech: 0 },
  { name: '카지노', quota: 32, escapeNeeded: 3, patrol: 1, vaultTech: 0 },
  { name: '은행', quota: 40, escapeNeeded: 4, patrol: 1, vaultTech: 1 },
];
