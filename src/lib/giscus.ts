// giscus (https://giscus.app) keeps page feedback in GitHub Discussions on this repo.
// The two ids come from giscus.app once Discussions is on and the giscus app is installed
// (LAUNCH.md, "Feedback"; both are filled in). Until both are set the Feedback component shows a plain GitHub
// issue link instead, so nothing third-party loads.
export const GISCUS = {
  repo: 'relatedb/relate-web',
  repoId: 'R_kgDOVi8WZA',
  category: 'Website',
  categoryId: 'DIC_kwDOVi8WZM4DKzAM',
};

export const giscusReady = Boolean(GISCUS.repoId && GISCUS.categoryId);
