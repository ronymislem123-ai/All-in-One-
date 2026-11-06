/** Repositories can follow a specific branch instead of the default branch (e.g. a feature branch). */
export const sql = /* sql */ `
ALTER TABLE repositories ADD COLUMN tracked_branch TEXT;
`;
