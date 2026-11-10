import type { ApiSchema } from '../../core/api/api-types';
import { moveOffsetMs, moveTargetOf } from './track-plan-move';

type Item = ApiSchema<'TrackPlanItem'>;
type Insert = ApiSchema<'TrackPlanInsert'>;

const HOUR = '2026-10-15T06:00:00Z';

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 1,
  track_id: 7,
  title: 'Song',
  duration_ms: 180_000,
  planned_start_utc: HOUR,
  planned_in_ms: 0,
  planned_out_ms: 180_000,
  truncated: false,
  source: 'fill',
  playlist: null,
  status: 'planned',
  ...overrides,
});

const insert = (overrides: Partial<Insert> = {}): Insert => ({
  id: 5,
  placement: 'fixed',
  offset_ms: 600_000,
  tolerance_ms: 60_000,
  track_id: 7,
  ...overrides,
});

describe('moveOffsetMs', () => {
  const items = [
    item({ id: 1 }),
    // 0:20 to 3:20 of the file: 3:00 on air, whatever the file's length is.
    item({
      id: 2,
      planned_start_utc: '2026-10-15T06:03:00Z',
      planned_in_ms: 20_000,
      planned_out_ms: 200_000,
    }),
    item({ id: 3, planned_start_utc: '2026-10-15T06:06:00Z' }),
  ];

  it('moving up takes the start of the row it lands on', () => {
    expect(moveOffsetMs(HOUR, items, 2, 1)).toBe(180_000);
    expect(moveOffsetMs(HOUR, items, 2, 0)).toBe(0);
  });

  it('moving down takes the end of the row it lands on, by the planned length', () => {
    expect(moveOffsetMs(HOUR, items, 0, 1)).toBe(360_000);
    expect(moveOffsetMs(HOUR, items, 0, 2)).toBe(540_000);
  });

  it('rounds to whole seconds', () => {
    const fractional = [
      item({ id: 1 }),
      item({ id: 2, planned_start_utc: '2026-10-15T06:03:00.400Z', planned_out_ms: 100_200 }),
      item({ id: 3, planned_start_utc: '2026-10-15T06:05:00.500Z' }),
    ];
    expect(moveOffsetMs(HOUR, fractional, 2, 1)).toBe(180_000);
    expect(moveOffsetMs(HOUR, fractional, 1, 2)).toBe(481_000);
    // 3:00.400 + 1:40.200 = 4:40.600
    expect(moveOffsetMs(HOUR, fractional, 0, 1)).toBe(281_000);
  });

  describe('at the end of the hour', () => {
    const closing = (lastMinute: number, lastLengthMs: number) => [
      item({ id: 1 }),
      item({ id: 2, planned_start_utc: '2026-10-15T06:50:00Z', planned_out_ms: 120_000 }),
      item({
        id: 3,
        planned_start_utc: `2026-10-15T06:${lastMinute}:00Z`,
        planned_out_ms: lastLengthMs,
      }),
    ];

    it('a drop on a last row ending at 60:00 makes the track the last of the hour', () => {
      expect(moveOffsetMs(HOUR, closing(57, 180_000), 0, 2)).toBe(3_420_000);
    });

    it('a drop before the last row uses the same rule when the longer track would cross 60:00', () => {
      const items = closing(58, 120_000);
      items[0] = item({ id: 1, planned_out_ms: 500_000, duration_ms: 500_000 });
      // The row before the last one ends at 52:00; 8:20 from there would reach 60:20.
      expect(moveOffsetMs(HOUR, items, 0, 1)).toBe(3_100_000);
    });

    it('rounds a fractional length down, so the track still ends by 60:00', () => {
      const items = closing(57, 180_000);
      items[0] = item({ id: 1, planned_out_ms: 200_500, duration_ms: 200_500 });
      // 60:00 less 3:20.5 is 56:39.5.
      expect(moveOffsetMs(HOUR, items, 0, 2)).toBe(3_399_000);
    });

    it('leaves a move that fits as it is', () => {
      // 52:00 plus 3:00 ends long before 60:00.
      expect(moveOffsetMs(HOUR, closing(58, 120_000), 0, 1)).toBe(3_120_000);
    });

    it('counts the whole length of a track cut in this build', () => {
      const items = closing(57, 180_000);
      items[0] = item({
        id: 1,
        planned_out_ms: 60_000,
        duration_ms: 240_000,
        truncated: true,
      });
      expect(moveOffsetMs(HOUR, items, 0, 2)).toBe(3_360_000);
    });

    it('does not apply to a move up', () => {
      const items = closing(57, 180_000);
      items[2] = item({
        id: 3,
        planned_start_utc: '2026-10-15T06:59:00Z',
        planned_out_ms: 400_000,
      });
      expect(moveOffsetMs(HOUR, items, 2, 1)).toBe(3_000_000);
    });
  });
});

describe('moveTargetOf', () => {
  it('pins a planned fill row', () => {
    expect(moveTargetOf(item({ id: 9 }), [], false)).toEqual({ kind: 'pin', planItemId: 9 });
  });

  it('moves a one-time insert or a reschedule with a fixed time', () => {
    const fixed = [insert()];
    expect(moveTargetOf(item({ source: 'hour_insert', hour_insert_id: 5 }), fixed, false)).toEqual({
      kind: 'insert',
      insertId: 5,
    });
    expect(moveTargetOf(item({ source: 'reschedule', hour_insert_id: 5 }), fixed, false)).toEqual({
      kind: 'insert',
      insertId: 5,
    });
  });

  it('does not move a one-time insert without a fixed time, or one it cannot find', () => {
    const atStart = [insert({ placement: 'start', offset_ms: undefined })];
    expect(moveTargetOf(item({ source: 'hour_insert', hour_insert_id: 5 }), atStart, false)).toBe(
      null,
    );
    expect(
      moveTargetOf(item({ source: 'hour_insert', hour_insert_id: 6 }), [insert()], false),
    ).toBe(null);
  });

  it.each(['rule', 'insert', 'general'] as const)('does not move a %s row', (source) => {
    expect(moveTargetOf(item({ source }), [], false)).toBe(null);
  });

  it.each(['queued', 'aired', 'missed', 'replaced'] as const)(
    'does not move a %s row',
    (status) => {
      expect(moveTargetOf(item({ status }), [], false)).toBe(null);
    },
  );

  it('moves nothing in a frozen hour', () => {
    expect(moveTargetOf(item(), [], true)).toBe(null);
  });
});
