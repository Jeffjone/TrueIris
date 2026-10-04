import { memo, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { TimelineData } from '@trueiris/schemas';
import {
  contextChanges,
  metrics,
  metricSegments,
  nearestPoint,
  pointTime,
  timeLabel,
} from './presentation';
export type Selection = { start: number; end: number };
const LEFT = 94,
  HEIGHT = 372;
export function TimelineChart({
  data,
  zone,
  selection,
  onSelect,
}: {
  data: TimelineData;
  zone: string;
  selection: Selection | null;
  onSelect: (value: Selection) => void;
}) {
  const [drag, setDrag] = useState<{ anchor: number; current: number } | null>(
    null,
  );
  const [cursor, setCursor] = useState(0);
  const [width, setWidth] = useState(800);
  const element = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > LEFT + 32) setWidth(Math.round(next));
    });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const RIGHT = width - 14;
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.end);
  const x = (time: number) =>
    LEFT + ((time - start) / (end - start)) * (RIGHT - LEFT);
  const at = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.round(
      start +
        Math.max(
          0,
          Math.min(
            1,
            (((event.clientX - bounds.left) / bounds.width) * width - LEFT) /
              (RIGHT - LEFT),
          ),
        ) *
          (end - start),
    );
  };
  function pointSelection(time: number) {
    const point = nearestPoint(data, time);
    if (point && Math.abs(pointTime(point) - time) <= 15_000)
      onSelect({ start: Date.parse(point.start), end: Date.parse(point.end) });
    else
      onSelect({
        start: Math.max(start, time - 15_000),
        end: Math.min(end, time + 15_000),
      });
  }
  const active = drag
    ? {
        start: Math.min(drag.anchor, drag.current),
        end: Math.max(drag.anchor, drag.current),
      }
    : selection;
  return (
    <svg
      className="timeline-chart"
      ref={element}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      tabIndex={0}
      role="application"
      aria-label="Today timeline chart"
      aria-describedby="timeline-instructions"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const time = at(event);
        setDrag({ anchor: time, current: time });
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, current: at(event) });
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerUp={(event) => {
        if (!drag) return;
        const time = at(event);
        const pixels = Math.abs(x(time) - x(drag.anchor));
        setDrag(null);
        if (pixels < 4) pointSelection(time);
        else
          onSelect({
            start: Math.min(time, drag.anchor),
            end: Math.max(time, drag.anchor),
          });
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          setCursor((c) =>
            Math.max(
              0,
              Math.min(
                data.points.length - 1,
                c + (event.key === 'ArrowRight' ? 1 : -1),
              ),
            ),
          );
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const point = data.points[cursor];
          if (point) pointSelection(pointTime(point));
        }
      }}
    >
      <title>
        Activity, signal gaps and physiological trends on a shared time axis
      </title>
      <TimelineTracks data={data} zone={zone} width={width} />
      {active && (
        <rect
          x={x(active.start)}
          y={18}
          width={Math.max(1, x(active.end) - x(active.start))}
          height={306}
          fill="#527960"
          fillOpacity={0.12}
          stroke="#527960"
          pointerEvents="none"
        />
      )}
      {data.points[cursor] && (
        <line
          className="timeline-cursor"
          x1={x(pointTime(data.points[cursor]!))}
          x2={x(pointTime(data.points[cursor]!))}
          y1={18}
          y2={324}
          stroke="#29372e"
          strokeDasharray="2 3"
        />
      )}
    </svg>
  );
}

// Selection gestures update only the overlay. Thousands of saved trend marks
// remain stable until a new query response arrives.
const TimelineTracks = memo(function TimelineTracks({
  data,
  zone,
  width,
}: {
  data: TimelineData;
  zone: string;
  width: number;
}) {
  const RIGHT = width - 14;
  const tickCount = Math.max(
    2,
    Math.min(5, Math.floor((RIGHT - LEFT) / 100) + 1),
  );
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.end);
  const x = (time: number) =>
    LEFT + ((time - start) / (end - start)) * (RIGHT - LEFT);
  const colors: Record<string, string> = {
    Coding: '#c7d8bc',
    Studying: '#ccdfd5',
    Reading: '#d7d7ba',
    Meeting: '#d6cee2',
    Break: '#e9d6b6',
    Other: '#d1dde3',
  };
  return (
    <>
      <rect x={LEFT} y={18} width={RIGHT - LEFT} height={306} fill="#f0f2eb" />
      {Array.from({ length: tickCount }, (_, i) => {
        const time = start + ((end - start) * i) / (tickCount - 1);
        return (
          <g key={i}>
            <line x1={x(time)} x2={x(time)} y1={18} y2={326} stroke="#dce1d6" />
            <text
              x={x(time)}
              y={350}
              className="timeline-tick-label"
              textAnchor={
                i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'
              }
            >
              {new Intl.DateTimeFormat('en-US', {
                timeZone: zone,
                hour: 'numeric',
                minute: '2-digit',
              }).format(time)}
            </text>
          </g>
        );
      })}
      <text x={8} y={39}>
        Activity
      </text>
      {data.activities.map((p, i) => (
        <g key={`${p.sessionId}:${p.start}`}>
          <rect
            data-testid="activity-band"
            x={x(Date.parse(p.start))}
            y={21}
            width={Math.max(0.6, x(Date.parse(p.end)) - x(Date.parse(p.start)))}
            height={27}
            rx={3}
            fill={p.activity ? colors[p.activity] : '#dfe2d9'}
          >
            <title>
              {p.activity ?? 'Activity not recorded'} ·{' '}
              {timeLabel(p.start, zone)} – {timeLabel(p.end, zone)}
            </title>
          </rect>
          {x(Date.parse(p.end)) - x(Date.parse(p.start)) > 65 && (
            <text x={x(Date.parse(p.start)) + 5} y={39}>
              {p.activity ?? 'Unlabeled'}
            </text>
          )}
          <desc>Period {i + 1}</desc>
        </g>
      ))}
      {data.gaps.map((g) => (
        <rect
          key={`${g.sessionId}:${g.start}:${g.kind}`}
          data-testid="signal-gap"
          x={x(Date.parse(g.start))}
          y={65}
          width={Math.max(0.7, x(Date.parse(g.end)) - x(Date.parse(g.start)))}
          height={259}
          fill={g.kind === 'missing' ? '#a6aca3' : '#d8b77a'}
          opacity={0.23}
        >
          <title>
            {g.kind === 'missing' ? 'No saved signal' : 'Values withheld'} ·{' '}
            {timeLabel(g.start, zone)} – {timeLabel(g.end, zone)}
          </title>
        </rect>
      ))}
      {metrics.map((metric, index) => {
        const points = data.points.filter((p) => p[metric.key].mean !== null);
        const low = Math.min(...points.map((p) => p[metric.key].min!)),
          high = Math.max(...points.map((p) => p[metric.key].max!));
        const pad = Number.isFinite(low) ? Math.max((high - low) * 0.15, 1) : 1;
        const bottom = low - pad,
          top = high + pad;
        const lane = 74 + index * 84;
        const y = (value: number) =>
          lane + 57 - ((value - bottom) / (top - bottom)) * 50;
        return (
          <g key={metric.key}>
            <text x={8} y={lane + 14} fill={metric.color}>
              {metric.label}
            </text>
            <text x={8} y={lane + 31}>
              {metric.unit}
            </text>
            <line
              x1={LEFT}
              x2={RIGHT}
              y1={lane + 64}
              y2={lane + 64}
              stroke="#dce1d6"
            />
            {points.length ? (
              <>
                <text x={LEFT + 3} y={lane + 6}>
                  {(top - pad).toFixed(0)}
                </text>
                <text x={LEFT + 3} y={lane + 58}>
                  {(bottom + pad).toFixed(0)}
                </text>
              </>
            ) : (
              <text x={LEFT + 12} y={lane + 33}>
                No accepted {metric.label.toLowerCase()} readings
              </text>
            )}
            {points.map((p) => (
              <line
                key={`${p.sessionId}:${p.start}`}
                x1={x(pointTime(p))}
                x2={x(pointTime(p))}
                y1={y(p[metric.key].min!)}
                y2={y(p[metric.key].max!)}
                stroke={metric.color}
                opacity={0.3}
                strokeWidth={2}
              />
            ))}
            {metricSegments(data, metric.key).map((segment, i) => (
              <g key={i} data-testid={`${metric.key}-segment`}>
                {segment.length > 1 && (
                  <path
                    d={segment
                      .map(
                        (p, j) =>
                          `${j ? 'L' : 'M'}${x(pointTime(p))},${y(p[metric.key].mean!)}`,
                      )
                      .join(' ')}
                    fill="none"
                    stroke={metric.color}
                    strokeWidth={1.8}
                  />
                )}
                {segment.length === 1 && (
                  <circle
                    cx={x(pointTime(segment[0]!))}
                    cy={y(segment[0]![metric.key].mean!)}
                    r={2.5}
                    fill={metric.color}
                  />
                )}
              </g>
            ))}
          </g>
        );
      })}
      {contextChanges(data).map((p) => (
        <line
          data-testid="context-change"
          key={`${p.sessionId}:${p.start}`}
          x1={x(Date.parse(p.start))}
          x2={x(Date.parse(p.start))}
          y1={18}
          y2={324}
          stroke="#7b8279"
          strokeDasharray="3 5"
        >
          <title>
            Manual activity changed to {p.activity ?? 'not selected'} at{' '}
            {timeLabel(p.start, zone)}
          </title>
        </line>
      ))}
    </>
  );
});
