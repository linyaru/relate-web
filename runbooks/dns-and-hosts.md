# DNS, hosts and certificates

## Where the site is served

| Host | What | Deployed by |
| --- | --- | --- |
| `https://relatedb.ai/` | Served from GitHub Pages: the four GitHub Pages A records on the apex (`185.199.108.153`–`185.199.111.153`) in DNS, and `www` pointing at the apex. Indexable. Obscure, not private: certificate-transparency logs expose it. | `deploy-pages.yml` |
| Cloudflare Pages project `relate-web` | Scalable host. Skips until its secrets exist. | `deploy-cf.yml` |

`public/CNAME` holds `relatedb.ai` and ships in the Pages artifact.

## Check

```bash
dig +short A relatedb.ai                       # expect: 185.199.108.153 … 185.199.111.153
curl -sI https://relatedb.ai/ | head -5
echo | openssl s_client -connect relatedb.ai:443 -servername relatedb.ai 2>/dev/null | openssl x509 -noout -subject -dates
```

## Failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `dig` returns nothing or the wrong name | The DNS record is missing or mistyped. | Fix the apex A records (the four GitHub Pages addresses); re-run `dig`. Propagation is minutes. |
| Browser: certificate error, or no HTTPS | GitHub has not issued the certificate yet, or "Enforce HTTPS" is off. | Repo Settings → Pages: confirm the custom domain `relatedb.ai` and that DNS check passed; tick **Enforce HTTPS** once it can be. Issuance can take up to an hour after DNS verifies. |
| 404 "There isn't a GitHub Pages site here" | Pages source is not "GitHub Actions", the deploy never ran, or the custom domain was cleared. | Settings → Pages → Source: **GitHub Actions**; re-run `Deploy site`; re-enter the custom domain in Settings → Pages (verify whether the `CNAME` file in the artifact alone is enough for Actions deploys; it has not been confirmed here). |
| Domain keeps resetting in Pages settings | Not using the Actions-deployed `CNAME`, or another repo has claimed it. | Re-set it; consider verifying `relatedb.ai` at the org level (TXT record) so no one else can claim its subdomains. |
| Pages deploy step fails with 404/permissions | `github-pages` environment or permissions (`pages: write`, `id-token: write`) missing; a private repo needs a paid plan to use Pages. | Check the repo's Pages settings and plan. |

## Launch host switch

The checklist is in `LAUNCH.md` ("Switch hosts"): DNS and TLS for `relatedb.ai`
and `www`, retire `deploy-pages.yml` and the `CNAME` file, serve from the
domain root, remove `noindex`, cache headers (long for `fonts/` and `wasm/`,
short for `index.html` and the discovery files; `.wasm` as `application/wasm`).
