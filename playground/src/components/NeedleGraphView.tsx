import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type NVL from '@neo4j-nvl/base';
import { TextButton } from '@neo4j-ndl/react';
import { GraphVisualization, type NeoNode, type NeoRel } from '@neo4j-ndl/react-graph';

import type { WireResult } from '../lib/wire';
import { EXPAND_LIMIT, engineIds, expandFromEngine } from '../lib/expand';
import { extractNeedleGraph, toNeoNode, toNeoRel } from '../lib/extract-graph';
import { useIsMobile } from '../hooks/useIsMobile';
import { useNvlTouch } from '../hooks/useNvlTouch';

interface Props {
  result: WireResult | null;
}

const SIDEPANEL_MIN_WIDTH = 230;
/** How many nodes a result draws, and how far expanding may grow the view. */
const MAX_DRAWN = 1000;

/** What double-click expansion added to the result's graph, and the engine id of each added node. */
interface Growth {
  nodes: NeoNode[];
  rels: NeoRel[];
  ids: Map<string, number>;
}
const noGrowth = (): Growth => ({ nodes: [], rels: [], ids: new Map() });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function NeedleGraphView({ result }: Props) {
  const isMobile = useIsMobile();
  const { nodes, rels, limitHit } = useMemo(() => {
    if (!result) return { nodes: [], rels: [], limitHit: false };
    return extractNeedleGraph(result, { nodeLimit: MAX_DRAWN });
  }, [result]);
  // Double-click to expand: a node's neighbours from the database are added
  // to the view, until the next result replaces it (or Reset).
  const baseIds = useMemo(() => (result ? engineIds(result) : new Map<string, number>()), [result]);
  const [grown, setGrown] = useState<Growth>(noGrowth);
  const [status, setStatus] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const resultRef = useRef(result);
  // Needle fits the view after each layout with `noPan`, so a new result (or
  // nodes added by expanding) can land outside a camera left by the previous
  // graph. A pending fit pans as well, once, when the next layout settles.
  const pendingFit = useRef(true);
  useEffect(() => {
    resultRef.current = result;
    pendingFit.current = true;
    setGrown(noGrowth());
    setStatus(null);
  }, [result]);
  const nvlCallbacks = useMemo(
    () => ({
      onLayoutComputing(isComputing: boolean) {
        const nvl = nvlRef.current;
        if (isComputing || !nvl) return;
        nvl.fit(
          nvl.getNodes().map((n) => n.id),
          pendingFit.current ? {} : { noPan: true },
        );
        pendingFit.current = false;
      },
    }),
    [],
  );
  const allNodes = useMemo(() => [...nodes, ...grown.nodes], [nodes, grown]);
  const allRels = useMemo(() => [...rels, ...grown.rels], [rels, grown]);
  // A graph too small to need a layout (one node, say) never reports one, so
  // a pending fit also runs shortly after the nodes change. It leaves the
  // flag for the layout, when there is one, to fit the settled positions.
  useEffect(() => {
    if (!pendingFit.current || allNodes.length === 0) return;
    const ids = allNodes.map((n) => n.id);
    const timer = window.setTimeout(() => nvlRef.current?.fit(ids), 300);
    return () => window.clearTimeout(timer);
  }, [allNodes]);

  const expand = useCallback(
    async (id: string) => {
      const engineId = grown.ids.get(id) ?? baseIds.get(id);
      if (expanding || engineId === undefined) return;
      const startedOn = resultRef.current;
      const drawn = new Set(allNodes.map((n) => n.id));
      const drawnEngine = allNodes.flatMap((n) => grown.ids.get(n.id) ?? baseIds.get(n.id) ?? []);
      setExpanding(true);
      setStatus('Expanding…');
      try {
        const found = await expandFromEngine(engineId, drawnEngine);
        // A new result replaced the view while the neighbours loaded.
        if (resultRef.current !== startedOn) return;
        const ids = new Map(grown.ids);
        const added: NeoNode[] = [];
        let full = false;
        for (const n of found.nodes) {
          const node = toNeoNode(n);
          if (drawn.has(node.id) || ids.has(node.id)) continue;
          if (drawn.size + added.length >= MAX_DRAWN) {
            full = true;
            continue;
          }
          added.push(node);
          ids.set(node.id, Number(n.id));
        }
        const present = new Set([...drawn, ...added.map((n) => n.id)]);
        const known = new Set(allRels.map((r) => r.id));
        const addedRels: NeoRel[] = [];
        for (const r of found.rels) {
          const rel = toNeoRel(r);
          if (known.has(rel.id) || !present.has(rel.from) || !present.has(rel.to)) continue;
          known.add(rel.id);
          addedRels.push(rel);
        }
        if (added.length === 0 && addedRels.length === 0) {
          setStatus(full ? `The view is full (${MAX_DRAWN} nodes).` : 'Nothing to add: every neighbour is drawn.');
          return;
        }
        pendingFit.current = true;
        setGrown((g) => ({ nodes: [...g.nodes, ...added], rels: [...g.rels, ...addedRels], ids }));
        const notes = [
          ...(found.truncated ? [`its first ${EXPAND_LIMIT} neighbours`] : []),
          ...(full ? [`the view is full at ${MAX_DRAWN} nodes`] : []),
        ];
        setStatus(
          `Added ${plural(added.length, 'node')} and ${plural(addedRels.length, 'relationship')}` +
            (notes.length ? ` (${notes.join('; ')}).` : '.'),
        );
      } catch (e) {
        if (resultRef.current === startedOn) setStatus(`Could not expand: ${(e as Error).message}`);
      } finally {
        setExpanding(false);
      }
    },
    [expanding, grown, baseIds, allNodes, allRels],
  );
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(SIDEPANEL_MIN_WIDTH);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState<boolean>(!isMobile);
  const nvlRef = useRef<NVL | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fitToGraph = useCallback(() => {
    if (nodes.length === 0) return;
    nvlRef.current?.fit(
      nodes.map((n) => n.id),
      { animated: false },
    );
  }, [nodes]);

  // Refit whenever the container resizes (covers tab switches where the
  // container starts hidden with 0×0 and later becomes visible).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    let last = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0 && Math.abs(w - last) > 4) {
        last = w;
        window.setTimeout(fitToGraph, 50);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes, fitToGraph]);

  useNvlTouch(containerRef, nvlRef, isMobile && nodes.length > 0);

  return (
    <div ref={containerRef} className="n-relative n-w-full n-h-full">
      {limitHit && (
        <div className="n-absolute n-top-2 n-left-2 n-z-10 n-px-2 n-py-1 n-rounded n-bg-neutral-bg-strong n-text-neutral-text-weak">
          Showing first 1000 nodes.
        </div>
      )}
      {!result && (
        <div className="n-flex n-h-full n-items-center n-justify-center n-text-neutral-text-weak">
          Run a query to see the graph.
        </div>
      )}
      {result && nodes.length === 0 && (
        <div className="n-flex n-h-full n-items-center n-justify-center n-text-neutral-text-weak">
          Query returned no graph entities.
        </div>
      )}
      {result && nodes.length > 0 && (
        <GraphVisualization
          nvlRef={nvlRef}
          nodes={allNodes}
          rels={allRels}
          nvlCallbacks={nvlCallbacks}
          mouseEventCallbacks={{ onNodeDoubleClick: (node: { id: string }) => void expand(node.id) }}
          bottomLeftIsland={
            <div
              role="status"
              data-graph-status
              className="n-flex n-items-center n-gap-2 n-px-2 n-py-1 n-rounded n-bg-neutral-bg-strong n-text-neutral-text-weak"
              style={{ fontSize: 12 }}
            >
              <span>{status ?? 'Double-click a node to expand it'}</span>
              {grown.nodes.length + grown.rels.length > 0 && !expanding && (
                <TextButton
                  size="small"
                  onClick={() => {
                    setGrown(noGrowth());
                    setStatus(null);
                  }}
                >
                  Reset
                </TextButton>
              )}
            </div>
          }
          className="n-w-full n-h-full n-border n-border-neutral-border-weak n-rounded-lg"
          sidepanel={{
            children: <GraphVisualization.SingleSelectionSidePanelContents />,
            isSidePanelOpen,
            setIsSidePanelOpen,
            sidePanelWidth,
            onSidePanelResize: setSidePanelWidth,
            minWidth: SIDEPANEL_MIN_WIDTH,
          }}
        />
      )}
    </div>
  );
}
