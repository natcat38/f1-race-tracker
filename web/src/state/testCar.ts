// Shared test fixture: a minimal valid Car matching the wire contract, with per-test
// overrides.

import type { Car } from './race';

// car() is the shared test fixture factory: a minimal valid Car (every required
// field of the wire contract, no optional ones) with per-test overrides spread on
// top. Lives here, next to the Car type it mirrors, so adding a required field to
// the contract breaks in one place rather than in every test file that had its own
// byte-identical copy.
export const car = (over: Partial<Car> = {}): Car => ({
  driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack', ...over,
});
