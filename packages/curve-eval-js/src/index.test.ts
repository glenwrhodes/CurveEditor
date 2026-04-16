import { evaluate, evaluateAll, evaluateState, getCurveNames, getCurveTimeRange } from './index';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, '..', '..', '..', 'test-fixtures');
const curveFile = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'test_curves.curve.json'), 'utf8'));
const expectedResults = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'expected_results.json'), 'utf8'));

describe('curve-eval', () => {
  describe('getCurveNames', () => {
    it('returns all curve names', () => {
      const names = getCurveNames(curveFile);
      expect(names).toContain('singleFloat');
      expect(names).toContain('linearPair');
      expect(names).toContain('trafficLight');
      expect(names).toContain('empty');
    });
  });

  describe('getCurveTimeRange', () => {
    it('returns time range for a curve', () => {
      const range = getCurveTimeRange(curveFile, 'linearPair');
      expect(range).toEqual({ start: 0, end: 1 });
    });

    it('returns null for empty curve', () => {
      expect(getCurveTimeRange(curveFile, 'empty')).toBeNull();
    });
  });

  describe('shared test fixtures', () => {
    for (const test of expectedResults.tests) {
      it(test.name, () => {
        const options = test.normalized ? { normalized: true } : undefined;

        if (test.expected_state) {
          const result = evaluateState(curveFile, test.curve, test.time, options);
          expect(result).not.toBeNull();
          expect(result!.index).toBe(test.expected_state.index);
          if (test.expected_state.label) {
            expect(result!.label).toBe(test.expected_state.label);
          }
        } else if (test.expected_vec) {
          const result = evaluate(curveFile, test.curve, test.time, options) as number[];
          expect(result).not.toBeNull();
          const tol = test.tolerance || 1e-6;
          for (let i = 0; i < test.expected_vec.length; i++) {
            expect(result[i]).toBeCloseTo(test.expected_vec[i], -Math.log10(tol));
          }
        } else if (test.expected_color) {
          const result = evaluate(curveFile, test.curve, test.time, options) as { r: number; g: number; b: number; a: number };
          expect(result).not.toBeNull();
          const tol = test.tolerance || 1e-6;
          expect(result.r).toBeCloseTo(test.expected_color.r, -Math.log10(tol));
          expect(result.g).toBeCloseTo(test.expected_color.g, -Math.log10(tol));
          expect(result.b).toBeCloseTo(test.expected_color.b, -Math.log10(tol));
          expect(result.a).toBeCloseTo(test.expected_color.a, -Math.log10(tol));
        } else if (test.expected === null) {
          const result = evaluate(curveFile, test.curve, test.time, options);
          expect(result).toBeNull();
        } else {
          const result = evaluate(curveFile, test.curve, test.time, options) as number;
          const tol = test.tolerance || 1e-6;
          expect(result).toBeCloseTo(test.expected, -Math.log10(tol));
        }
      });
    }
  });

  describe('evaluateAll', () => {
    it('evaluates all curves at a given time', () => {
      const result = evaluateAll(curveFile, 0.5);
      expect(result).toHaveProperty('singleFloat');
      expect(result).toHaveProperty('linearPair');
      expect(result.linearPair).toBeCloseTo(0.5, 5);
    });
  });
});
