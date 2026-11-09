# The live demo, cookbook runner or playground is broken

The engine ships as WASM in `public/wasm/` (a copy of upstream
`surfaces/relate-wasm/pkg/`): `relate.js`, `relate_bg.wasm`, `opfs.js`,
`trap.js`, `snippets/`, plus `.d.ts` files. It is loaded **at runtime** from
`/wasm/relate.js` and constructs `RelateDb`; Vite never bundles it (keep it in
`public/`). The home console, cookbook, docs cells and playground all use it.
The cookbook runs steps in a module worker (`src/scripts/cookbook/worker.ts`).

## Check

1. Are the files served, with the right type?
   ```bash
   HOST=https://r31473.relatedb.ai
   curl -sI $HOST/wasm/relate_bg.wasm | grep -i 'HTTP\|content-type\|content-length'   # 200, application/wasm, non-trivial size
   curl -sI $HOST/wasm/relate.js | head -3
   ```
2. Does it work in a browser? Open the page with DevTools: Console and Network.
   Look for a failed `/wasm/…` request, a MIME-type error for `.wasm`, a worker
   error, or a `RelateDb` / import error.
3. Does CI see it? `Cookbook` workflow: `cookbook:check` runs every recipe on
   `public/wasm`; `cookbook:browser` runs them in headless Chrome after a build.
   ```bash
   npm run cookbook:check
   npm run build && npm run cookbook:browser      # needs Chrome (CHROME_PATH)
   ```

## Failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Console stuck on "loading", `/wasm/…` 404 | `public/wasm/` incomplete, or an old path. | `ls public/wasm`; compare with the file list above; refresh from upstream (below). |
| `.wasm` fails with a MIME error | Host serves it without `application/wasm`. | Fix the host's type or headers. GitHub Pages and Cloudflare Pages serve it correctly; a new host needs this checked. |
| `RelateDb is not a constructor`, import errors | `relate.js` and `relate_bg.wasm` from different builds, or an API rename upstream. | Re-copy the whole `pkg/` together; grep the callers (`RelateDb`, `./wasm/relate.js`). |
| A recipe's recorded result differs | The engine changed. | Decide if it is intended; if so `npm run cookbook:record`, review the diff. If not, the wrong WASM was copied. |
| Works locally, fails deployed | Stale cache of old WASM, or `base` path assumptions. | Hard refresh; `curl -sI` and compare `etag`; check no root-relative path assumes a subpath. |
| Cookbook worker fails | A Node-only import crept into a module shared with the runtime. | `result-view.ts`, `cells.ts`, `graph-model.ts`, `palette.ts` must stay free of Node imports. |
| Graph view fails to load | NVL (pinned 1.2.2) lazy load, or the telemetry alias in `astro.config.mjs`. | Console/Network; the graph loads only when a graph result scrolls into view. |

## Refresh the WASM from upstream

```bash
cd <upstream relate checkout> && bash scripts/build-wasm.sh --mode release     # toolchain 1.88.0, target wasm32-unknown-unknown
# copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into public/wasm/
npm run cookbook:check && npm run docs:check
```

On a release, `engine-release.yml` does this into a pull request from the
`@relate/relate-wasm` package (see [release-discovery.md](release-discovery.md)).

## Roll back

`git revert` the commit that changed `public/wasm/`: [rollback-site.md](rollback-site.md).
