/**
 * The `/readyz` contract, its validator, and the mapping to user-facing state.
 *
 * Kept separate from the network layer so the parsing and status rules can be
 * tested as pure functions.
 */

export type ReadinessComponent =
  | "database"
  | "model"
  | "qdrant"
  | "object_storage";

/**
 * `configured` and `reachable` are independent: configuration can be present
 * while the probe still fails. The UI must not collapse them into one boolean.
 */
export interface ComponentReadiness {
  configured: boolean;
  reachable: boolean;
}

export interface ReadinessReport {
  status: "ready" | "not_ready";
  components: Record<ReadinessComponent, ComponentReadiness>;
}

export const READINESS_COMPONENTS: readonly ReadinessComponent[] = [
  "database",
  "model",
  "qdrant",
  "object_storage",
];

export const COMPONENT_LABELS: Record<ReadinessComponent, string> = {
  database: "PostgreSQL",
  model: "Model provider",
  qdrant: "Qdrant",
  object_storage: "Object storage",
};

/** Distinct user-facing states, in increasing order of health. */
export type ComponentState = "not_configured" | "unreachable" | "ready";

export const COMPONENT_STATE_LABELS: Record<ComponentState, string> = {
  not_configured: "Not configured",
  unreachable: "Unreachable",
  ready: "Ready",
};

/**
 * Map the two-field component model onto three distinct states.
 *
 * "Not configured" (setting missing) and "Unreachable" (setting present, probe
 * failed) are deliberately different: they need different operator responses.
 */
export function componentState(component: ComponentReadiness): ComponentState {
  if (!component.configured) return "not_configured";
  return component.reachable ? "ready" : "unreachable";
}

function isComponentReadiness(value: unknown): value is ComponentReadiness {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.configured === "boolean" &&
    typeof candidate.reachable === "boolean"
  );
}

/**
 * Validate an unknown payload against the readiness contract.
 *
 * Returns `null` for anything that does not match exactly, so a malformed body
 * is treated as an API error rather than being rendered as partial truth.
 */
export function parseReadinessReport(value: unknown): ReadinessReport | null {
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "not_ready") {
    return null;
  }

  const rawComponents = candidate.components;
  if (typeof rawComponents !== "object" || rawComponents === null) return null;

  const source = rawComponents as Record<string, unknown>;
  const components = {} as Record<ReadinessComponent, ComponentReadiness>;

  for (const name of READINESS_COMPONENTS) {
    const entry = source[name];
    if (!isComponentReadiness(entry)) return null;
    components[name] = { configured: entry.configured, reachable: entry.reachable };
  }

  return { status: candidate.status, components };
}
