# ADR-0008: The style guide: voice, tone by page type, and enforced vocabulary

Status: Accepted

Date: 2026-11-07

## Context

Two readers see every page: a developer and an agent that will act on the
text literally. The Google, Microsoft, GitLab, and Mintlify style guides
agree on the mechanics (second person, active voice, contractions,
sentence-case headings phrased as intent, one term per concept, a prose
linter in CI); Mailchimp supplies the model of a constant voice and a
situational tone; Diátaxis supplies the language of each section; the
agent-readability guidance adds self-contained sections, exact strings,
importance words, and tables for constraints. The maintainers want the
docs to read as helpful, optimistic, and a little fun without overdoing
it. `MAINTAINING.md` already bans marketing fluff and reserves "full".

## Decision

A style guide, written before any page, lives at
`src/content/docs/STYLE.md` and in `DOCS-PLAN.md` §4. Its load-bearing
choices:

- Voice is four words with limits: plainspoken, helpful, optimistic, a
  little fun. The fun has a budget and a place (tutorial openings and
  finish lines, tips, example data) and places it never goes (headings,
  reference, warnings, errors, limits, security). The test for any joke is
  that it stays true and clear when read with a straight face by a
  non-native speaker or a model; irony and sarcasm fail it. If in doubt,
  keep a straight face.
- Tone follows the section: warm with "we" in Get started, direct
  imperatives in Guides, austere with no personality in Reference, candid
  with a view in Concepts. Errors, limits, previews, and security have
  their own situational rules.
- The product is `relate`, lowercase, in prose. American spelling. One
  name per thing, with the banned spellings generated from the glossary
  (ADR-0009). A banned-words list (simply, just, easy, please, leverage,
  seamless, "full" outside its reserved use, and so on). One exclamation
  mark per tutorial at most, in its last paragraph; none elsewhere; no
  emoji.
- Code and output rules: copyable shell blocks, output pasted from a run
  against the page's verified version, exact error strings, right way
  first and wrong way only paired and labelled.
- Agent rules: answer first, self-contained sections, importance words,
  the critical fact repeated where it bites, nothing only in a picture or
  behind a click.
- Vale with the Google base style and a generated relate vocabulary runs
  in CI; a custom script checks frontmatter, fences, links, and page shape.

## Alternatives considered

- **Adopt the Google style guide as-is.** Complete and proven. Rejected
  as the whole answer: it has no section-specific tone, no agent rules,
  and its humour guidance ("let some personality show") needed the
  concrete budget the maintainers asked for.
- **"You" everywhere, including tutorials.** Google's and Mintlify's
  rule. Rejected: Diátaxis's "we" is the warmth tutorials are allowed and
  nowhere else, which is also where the fun budget lives.
- **Upstream's spelling of the name, "Relate".** Consistency with the
  README. Rejected: the site has used lowercase since the rename, and one
  spelling in code and prose is unambiguous for an agent; upstream is
  asked to follow.

## Consequences

- Every page is reviewed against the guide; the mechanical rules fail CI.
- The release-time update agent gets the guide as its checklist.
- Changing the voice or a banned word is a new ADR, not an edit to the
  guide.
