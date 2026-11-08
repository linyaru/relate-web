# ADR-0040: The geospatial explorer searches the page's own cells on a plane, with a first frame laid out at record time

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists a geospatial explorer for guides/cypher/geospatial:
points on a plane, a radius and a box the reader drags, the query re-run as
the shape moves, and the point index's effect. The interactive element
framework (ADR-0035, the framework) requires the engine's own numbers, a
static form built at record time, and a lazy module. The page already
teaches the searches as cells: the places, `point.distance` within a
radius, `point.withinBBox`, and `CREATE POINT INDEX`. A map with tiles
would need a tile server, a licence and network fetches the site does not
make (ADR-0010 keeps the page's runtime to the engine and NVL).

## Decision

1. **`:::geo-explorer{points= radius= box= index= [extent=]}` names cells,
   never statements.** `points` returns the places (`name`, `latitude`,
   `longitude`, `kind`); `radius` and `box` are the page's searches with
   parameters `{lat, lon, radius}` and `{south, west, north, east}`;
   `index` is the cell that creates the point index; `extent` sets the
   meters the plane covers around the circle's center (five radii by
   default). `validate` checks that each cell exists and takes the
   parameters it is run with, so what the explorer runs is what the page
   teaches.
2. **A plane, not a map.** Longitude across and latitude up, scaled around
   the radius cell's center, drawn as SVG with no tiles and no network.
   Places beyond the plane are named under it and not drawn; without the
   index the scan still reads them. The geometry
   (`_geo-explorer-plane.ts`) is shared by the build and the browser, so the
   live plane starts from the frame the static form drew.
3. **The static form is the first frame.** The radius cell's recorded table,
   a line naming the places beyond the plane, and the plane with the
   default circle and the recorded matches lit, laid out at record time in
   both themes and hash-stamped like every element picture.
4. **Live, each move re-runs the page's cell.** Dragging, the arrow keys or
   `+` and `-` move or resize the shape; the search runs again on the
   page's database with the shape as its parameters, at most once per
   throttle interval while it moves and always once after it stops, with
   `PROFILE` in front so the scan's database hits are the engine's. The
   matches light up with their names and fill a table; the statement and
   parameters show as they ran. The live region announces only the search
   after the shape stops, so a drag or a held arrow key is one
   announcement. The index button runs the page's `index` cell, or
   `DROP INDEX … IF EXISTS`, and searches again; a timing row keeps each
   run's parse, plan and execute times and the scan's hits with the index
   off and on, drawn with the timing element's model (`_timing-model.ts`)
   and look, so a phase reads the same in every bar on the site. The
   engine loads on the first move or press, not on scroll.
5. **A finger on the shape drags it; elsewhere it scrolls.** A touch that
   starts on the shape or its handle moves or resizes it, and the page does
   not scroll under it; a finger on the open plane scrolls the page, and
   the shape stays and the engine does not load. Chrome reads
   `touch-action` only on the `<svg>` root, not on the shapes inside it,
   so the shape claims a one-finger touch by cancelling `touchstart` (a
   non-passive listener). A touch with two fingers is left to the browser
   to pinch-zoom, and a second finger ends a drag in progress. A tap, or a
   touch the browser cancels before the shape moved, runs no search.

## Alternatives considered

- **A tile map (OpenStreetMap or similar).** It is what a reader expects of
  places. Rejected: tiles are network fetches from another origin, with a
  licence and an outage the page would inherit. Six of the eight places sit
  in one city, and the explorer names the other two as beyond the plane.
- **Statements in attributes.** Rejected: they would have no recording to
  build the static form from, and could drift from the page's cells.
- **Showing the index's effect as time.** Rejected: with eight places the
  timings are too small to show the index's effect; the scan's database
  hits show it, and the times stay beside them as measured.
- **Searching on every pointer move.** Rejected: a drag fires dozens of
  moves a second; the throttle keeps the engine responsive and the final
  search always runs.

## Consequences

- guides/cypher/geospatial gains the explorer and a section on searching
  an area; its sections need new embeddings.
- A reader who presses the index button changes the page's database until
  it is pressed off or the page is reset.
- The plane covers one city's scale: its equirectangular projection
  distorts beyond that, so a page with places spread over a continent
  would need another projection.
- At phone width the circle covers much of the plane, so a reader who
  starts a scroll on it drags it instead and starts the engine; the open
  plane around it still scrolls.
- A pinch whose two fingers land together zooms the page anywhere on the
  plane. A pinch whose first finger lands on the shape before the second
  does not zoom: once a `touchstart` is cancelled, Chrome makes no pinch of
  that touch sequence. The drag ends where the first finger left the
  shape, with one search if it moved. Cancelling `touchmove` instead,
  which would leave the pinch to the browser, did not stop the page
  scrolling under a one-finger drag in Chrome.
