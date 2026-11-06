// Stands in for @segment/analytics-next, which NVL imports for its side
// effects only (its telemetry). The graph view turns telemetry off, and
// astro.config.mjs aliases the package here so none of its code ships.
export {};
