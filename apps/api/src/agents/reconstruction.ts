import { localDaypart } from './recent';
import type {
  AgentEvidence,
  TimelineData,
  BaselineData,
  TimelineQuery,
} from '@trueiris/schemas';
/** Recorded events only. Observation timestamps never establish when an app opened or work began. */
export function reconstructEvents(
  data: TimelineData,
  baseline: BaselineData | null,
  id: string,
): AgentEvidence {
  const events: {
    time: string;
    end: string;
    text: string;
    value: number | null;
  }[] = [];
  const add = (
    time: string,
    end: string,
    text: string,
    value: number | null = null,
  ) => {
    if (
      time >= data.range.start &&
      time < data.range.end &&
      end > time &&
      end <= data.range.end
    )
      events.push({ time, end, text, value });
  };
  const contexts = [...(data.contexts ?? [])].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  let previous: (typeof contexts)[number] | undefined;
  let overlap = false,
    latestEnd = '';
  for (const c of contexts) {
    if (c.start < latestEnd) overlap = true;
    latestEnd = latestEnd > c.end ? latestEnd : c.end;
  }
  if (!overlap)
    for (const c of contexts) {
      const continuous =
        previous?.sessionId === c.sessionId && previous.end === c.start;
      if (
        c.application &&
        (!continuous || previous?.application?.id !== c.application.id)
      ) {
        const app = JSON.stringify(
          Array.from(c.application.name, (char) =>
            char.codePointAt(0)! < 32 || char.codePointAt(0) === 127
              ? ' '
              : char,
          )
            .join('')
            .slice(0, 80),
        );
        add(
          c.start,
          c.end,
          continuous
            ? `Foreground application changed to ${app}.`
            : `Recorded ${app} in the foreground; its opening time is unknown.`,
        );
      }
      if (!continuous || c.manualActivity !== previous?.manualActivity) {
        if (c.manualActivity)
          add(
            c.start,
            c.end,
            `You labeled the recorded activity ${c.manualActivity}.`,
          );
      }
      if (continuous && c.idle !== previous?.idle)
        add(
          c.start,
          c.end,
          c.idle
            ? 'Recorded desktop inactivity.'
            : 'Recorded desktop activity resumed.',
        );
      if (continuous && c.applicationSwitches > previous!.applicationSwitches) {
        const count = c.applicationSwitches - previous!.applicationSwitches;
        add(
          c.start,
          c.end,
          `Recorded ${count} application ${count === 1 ? 'switch' : 'switches'} since the preceding context interval.`,
          count,
        );
      }
      previous = c;
    }
  const labels = new Map<string, string | null>();
  for (const a of [...data.activities].sort((a, b) =>
    a.start.localeCompare(b.start),
  )) {
    if (a.activity && labels.get(a.sessionId) !== a.activity)
      add(
        a.start,
        a.end,
        `Saved sensing readings carry your manual ${a.activity} label.`,
      );
    labels.set(a.sessionId, a.activity);
  }
  const comparison = baseline?.comparisons[0];
  let last: TimelineData['points'][number] | undefined;
  for (const p of [...data.points].sort((a, b) =>
    a.first.localeCompare(b.first),
  )) {
    if (
      p.pulse.count < 15 ||
      p.pulse.mean === null ||
      p.first < data.range.start ||
      p.last >= data.range.end
    )
      continue;
    const end = new Date(
      Math.min(Date.parse(data.range.end), Date.parse(p.last) + 1),
    ).toISOString();
    if (
      !last ||
      last.sessionId !== p.sessionId ||
      Date.parse(p.first) - Date.parse(last.last) > 31_000
    ) {
      add(
        p.first,
        end,
        `Recorded pulse averaged ${p.pulse.mean.toFixed(1)} bpm across ${p.pulse.count} accepted readings.`,
        p.pulse.mean,
      );
    } else if (p.pulse.mean !== last.pulse.mean) {
      add(
        p.first,
        end,
        `A later recorded pulse epoch averaged ${p.pulse.mean.toFixed(1)} bpm, ${p.pulse.mean > last.pulse.mean! ? 'above' : 'below'} the preceding epoch's ${last.pulse.mean!.toFixed(1)} bpm. This compares saved epochs, not unrecorded time.`,
        p.pulse.mean,
      );
    }
    if (
      !data.limited &&
      comparison?.state === 'ready' &&
      comparison.baseline !== null &&
      baseline
    ) {
      const context = baseline.query.context;
      const matches = (point: TimelineData['points'][number]) =>
        (context.kind === 'time_of_day' &&
          localDaypart(point.first, baseline.query.timezone) ===
            context.period &&
          localDaypart(point.last, baseline.query.timezone) ===
            context.period) ||
        data.activities.some(
          (a) =>
            a.sessionId === point.sessionId &&
            context.kind === 'activity' &&
            a.activity === context.activity &&
            a.start <= point.first &&
            a.end > point.last,
        );
      if (matches(p)) {
        const label =
          context.kind === 'activity' ? context.activity : context.period;
        const difference = p.pulse.mean - comparison.baseline;
        add(
          p.first,
          end,
          `This pulse epoch was ${Math.abs(difference).toFixed(1)} bpm ${difference >= 0 ? 'above' : 'below'} your earlier ${label} baseline of ${comparison.baseline.toFixed(1)} bpm.`,
          difference,
        );
        if (
          last?.sessionId === p.sessionId &&
          matches(last) &&
          Date.parse(p.first) - Date.parse(last.last) <= 31_000 &&
          Math.abs(difference) <
            Math.abs(last.pulse.mean! - comparison.baseline)
        )
          add(
            p.first,
            end,
            'This recorded pulse epoch was closer to that earlier baseline than the preceding epoch. Intervening unrecorded time remains unknown.',
          );
      }
    }
    last = p;
  }
  for (const gap of data.gaps)
    add(
      gap.start,
      gap.end,
      gap.kind === 'withheld'
        ? 'Signal quality withheld physiological readings during this interval.'
        : 'Physiological observations are missing during this interval.',
    );
  events.sort((a, b) => a.time.localeCompare(b.time));
  const cautions = [
    'This reconstruction describes first-party recordings only. Unrecorded time, task contents, intentions and causes are unknown.',
    ...(overlap
      ? [
          'Overlapping desktop sessions prevent a reliable order of application changes; those events are omitted.',
        ]
      : []),
    ...(!contexts.length
      ? ['No desktop context was saved in this range.']
      : []),
    ...(!baseline || comparison?.state !== 'ready'
      ? ['A supported personal pulse baseline is unavailable for this range.']
      : []),
    ...(data.limited || events.length > 18
      ? [
          'The event list is partial; select a shorter range to inspect additional observations.',
        ]
      : []),
    ...(!events.length
      ? ['No reconstructable observations were saved in this range.']
      : []),
  ];
  const facts: AgentEvidence['facts'] = events.slice(0, 18).map((e, i) => ({
    id: `${id}.f${i + 1}`,
    text: e.text,
    value: e.value,
    range: {
      ...data.range,
      start: e.time,
      end: e.end,
    } satisfies TimelineQuery,
  }));
  const limitations: string[] = [];
  for (const text of cautions) {
    const factId = `${id}.f${facts.length + 1}`;
    facts.push({ id: factId, text, value: null, range: data.range });
    limitations.push(factId);
  }
  return {
    id,
    tool: 'reconstruct_events',
    title: 'Recorded events',
    range: data.range,
    status: !events.length
      ? 'empty'
      : data.limited || overlap || events.length > 18
        ? 'limited'
        : 'ready',
    facts,
    limitations,
  };
}
