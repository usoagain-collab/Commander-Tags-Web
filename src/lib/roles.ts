// Default role targets (CLAUDE.md / spec). They don't change with bracket; users can save their own in their profile.
// Role-to-tag mapping is ported from the prototype in Phase 3.
export const DEFAULT_ROLE_TARGETS: Record<string, number> = {
  lands: 37,
  ramp: 10,
  draw: 10,
  removal: 8,
  wipes: 3,
  protection: 3,
  recursion: 2,
};
