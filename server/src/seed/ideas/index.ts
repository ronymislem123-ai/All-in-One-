/**
 * Curated idea library (transparent, local – no AI involved at runtime).
 * The parts are plain JSON so they can be reviewed and extended without touching code.
 */
export interface SeedIdea {
  slug: string;
  title: string;
  summary: string;
  description: string;
  problem: string;
  goal: string;
  benefit: string;
  audience: string;
  category: string;
  subcategory: string;
  features: string[];
  highlights: string[];
  complexity: number;
  effort: 'xs' | 's' | 'm' | 'l' | 'xl';
  technologies: string[];
  prerequisites: string[];
  extensions: string[];
  risks: string[];
  monetization: { assessment: string; confidence: 'plausibel' | 'spekulativ' | 'nicht-vorgesehen' };
  scores: { originality: number; usefulness: number; feasibility: number };
  tags: string[];
}

import part1 from './ideas-part-1.json';
import part2 from './ideas-part-2.json';
import part3 from './ideas-part-3.json';

export const SEED_IDEAS: SeedIdea[] = [...part1.ideas, ...part2.ideas, ...part3.ideas] as SeedIdea[];
/** Bump when new library ideas are added – existing (possibly edited) ideas are never overwritten. */
export const SEED_IDEAS_VERSION = 1;
