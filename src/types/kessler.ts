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
  | 'cascade_escalating';

export const CASCADE_SETTLE_MS = 3500;
export const CASCADE_APPROACH_MS = 3500;
export const CASCADE_IMPACT_MS = 800;
