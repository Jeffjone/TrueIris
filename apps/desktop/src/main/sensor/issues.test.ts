import { describe, expect, it } from 'vitest';
import { errorIssue, validationIssue, ProcessingLifecycle } from './issues';
describe('Presage status codes', () => {
  it('allows initialization idle, then detects an unexpected end of a running session', () => {
    const lifecycle = new ProcessingLifecycle();
    for (const status of [0, 1, 2, 1, 3])
      expect(lifecycle.unexpectedlyIdle(status)).toBe(false);
    expect(lifecycle.unexpectedlyIdle(1)).toBe(true);
  });
  it.each([
    [0, 'none'],
    [1, 'no_face'],
    [2, 'multiple_faces'],
    [5, 'lighting'],
    [6, 'lighting'],
    [12, 'motion'],
    [13, 'positioning'],
    [10, 'calibrating'],
  ])('maps validation %s', (code, expected) => {
    expect(validationIssue(code as number)).toBe(expected);
  });
  it.each([
    [2, 'authentication'],
    [4, 'authentication'],
    [5, 'network'],
    [6, 'network'],
    [7, 'no_camera'],
    [8, 'processing'],
  ])('maps error %s', (code, expected) => {
    expect(errorIssue(code)).toBe(expected);
  });
});
