import data from './articles.json';

export interface SeedArticle {
  slug: string;
  title: string;
  topic: 'claude-code' | 'mcp' | 'api' | 'prompting' | 'workflows' | 'claude-apps';
  difficulty: 'einsteiger' | 'fortgeschritten' | 'experte';
  summary: string;
  body: string;
  sources: { title: string; url: string }[];
  verification: 'verified' | 'unverified';
  verifiedAt: string | null;
}

/** Claude Knowledge Hub seed – each article cites the official pages it was checked against (generatedAt). */
export const SEED_ARTICLES = data.articles as SeedArticle[];
export const SEED_ARTICLES_VERSION = 1;
export const SEED_ARTICLES_GENERATED_AT = data.generatedAt;
