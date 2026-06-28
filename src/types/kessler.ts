export type KesslerSimState =
  | 'idle'
  | 'initializing'
  | 'countdown'
  | 'frozen'
  | 'collision_sequence'
  | 'impact'
  | 'debris_drifting'
  | 'cascade_approach'
  | 'cascade_impact'
  | 'cascade_escalating'
  | 'final_highlight'
  | 'final_approach'
  | 'final_impact_1'
  | 'final_impact_2'
  | 'final_impact_3'
  | 'kessler_cascade_active';

export const CASCADE_SETTLE_MS = 3500;
export const CASCADE_APPROACH_MS = 3500;
export const CASCADE_IMPACT_MS = 800;

export const FINAL_BUILDUP_MS = 4500;
export const FINAL_HIGHLIGHT_STAGGER_MS = 500;
export const FINAL_HIGHLIGHT_DURATION_MS = 1500;
export const FINAL_APPROACH_MS = 3500;
export const FINAL_COLLISION_STAGGER_MS = 700;
export const FINAL_OBSERVE_MS = 4500;
export const FINAL_DEBRIS_COUNTS = [11, 10, 12] as const;
