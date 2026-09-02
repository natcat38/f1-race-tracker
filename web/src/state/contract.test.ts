// Contract test: the golden snapshot fixture must apply cleanly through the frontend
// reducer.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { emptyState, applyMessage } from './race';

// Guards the Go<->TS wire contract: both sides parse the SAME checked-in fixture
// (testdata/contract/golden_snapshot.json at the repo root) and must agree on
// every field. See internal/model/contract_test.go for the Go half. A silent
// field-name/shape drift between model.go and this file's mirrored types fails
// here, in CI, rather than as a runtime "undefined" deep in the frontend.
describe('golden snapshot contract', () => {
  it('parses the same checked-in fixture the Go side asserts against', () => {
    const raw = readFileSync('../testdata/contract/golden_snapshot.json', 'utf-8');
    const data = JSON.parse(raw);
    const s = applyMessage(emptyState(), { type: 'snapshot', data });

    expect(s.session).toBe('contract-test');
    expect(s.mode).toBe('replay');
    expect(s.label).toBe('Contract Fixture');
    expect(s.rev).toBe(42);
    expect(s.timeMs).toBe(3300000);
    expect(s.totalLaps).toBe(53);
    expect(s.track).toHaveLength(2);
    expect(s.track[1]).toEqual({ x: 0.9, y: 0.8 });
    expect(s.corners).toHaveLength(1);
    expect(s.corners[0]).toEqual({ number: 1, x: 0.1, y: 0.2 });

    expect(Object.keys(s.cars)).toHaveLength(2);
    expect(s.cars[1].driverNum).toBe(1);
    expect(s.cars[1].code).toBe('VER');
    expect(s.cars[1].lap).toBe(12);
    expect(s.cars[1].status).toBe('OnTrack');
    expect(s.cars[1].tyre).toBe('SOFT');
    expect(s.cars[1].tyreAge).toBe(5);
    expect(s.cars[1].drs).toBe(true);
    expect(s.cars[44].status).toBe('Pit');

    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].message).toBe('GREEN FLAG');
    expect(s.radio).toHaveLength(1);
    expect(s.radio[0].driverNum).toBe(1);
    expect(s.lapTrace[1]).toHaveLength(4);

    expect(s.stints[1]).toHaveLength(2);
    expect(s.stints[1][1].compound).toBe('HARD');
    expect(s.stints[1][1].startLap).toBe(15);
    expect(s.pitStops[1]).toHaveLength(1);
    expect(s.pitStops[1][0].lap).toBe(14);
    expect(s.pitStops[1][0].durationS).toBe(23.4);
    expect(s.pedalTraces[1].throttle).toEqual([0, 40, 100, 100]);
    expect(s.pedalTraces[1].brake).toEqual([0, 60, 0, 0]);
    expect(s.pedalTraces[1].gear).toEqual([1, 3, 7, 7]);
    expect(s.sectorDominance).toEqual([1]);
    expect(s.weather?.trackTempC).toBe(41.2);
    expect(s.weather?.airTempC).toBe(28.5);
    expect(s.weather?.rainfall).toBe(false);
  });
});
