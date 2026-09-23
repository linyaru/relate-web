# PLAN — cypherlite website redo (branch `new-website`, based on `gh-pages`)

Goal: replace the Docusaurus site with a neo4j-cli-style single-page static site
(modern, concise, agent-first), keep `install.sh`, add `llms.txt`, add a
placeholder for a future live WASM memory console.

| Step | Priority | Status | Notes |
|---|---|---|---|
| 10. Study neo4j-cli gh-pages design (index.html, llms.txt) | 8 | done | single page, Public Sans/Fira Code, cli/agentic mode toggle |
| 20. Gather cypherlite content (README, docusaurus md, api specs) | 8 | done | distilled, no architecture deep-dives |
| 30. Author new index.html (hero, install tabs, quickstart, WASM console placeholder, examples, reference) | 9 | done | 87 KB single file, same CSS/JS skeleton as neo4j-cli |
| 40. Author llms.txt (no numeric TCK levels — "full coverage") | 8 | done | |
| 50. Fonts, robots.txt, sitemap.xml, favicon | 7 | done | fonts copied from neo4j-cli site |
| 60. Remove Docusaurus build output (assets/, docs/, 404.html, undraw imgs) | 9 | done | kept: install.sh, .nojekyll, img/favicon.ico |
| 70. Validate HTML balance + links | 7 | done | parser clean; bolt binary name verified |
| 80. Commit `new-website` (gh-pages base) | 9 | pending | awaiting user confirmation |
| 85. gh-pages: MAINTAINING.md, last-sync-sha.txt, reference update-website.yml | 8 | done | website-update action contract + sync marker |
| 90. Main branch: remove Docusaurus source + tutorials/redundant explanations/performance-notes | 9 | done | guides+reference kept as plain md; limitations + storage-engine kept; install.sh → distribution/ |
| 100. Main branch: deploy pipeline — docs.yml deleted; release.yml docs job now only syncs distribution/install.sh to gh-pages (no force-push) | 9 | done | site lives on gh-pages, no build |
| 105. Main branch: update-website.yml + .github/prompts/website-update.md (release-triggered agent sync) | 9 | done | branch `update-website-action`, worktree ../cypherlite-main-web; needs FIREWORKS_API_KEY secret (FireConnect routes Claude Code via Fireworks) |
| 110. Update README docs pointer | 6 | done | points to gh-pages branch + docs/ |
| 120. Future: live WASM memory console in the placeholder section | 5 | pending | needs cypherlite WASM build |
