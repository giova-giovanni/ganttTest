import React from 'react';
import type { Lang, Status } from '../types';
import {
  addDays,
  diffDays,
  isoWeek,
  isWeekend,
  monthName,
  parseISO,
  startOfWeek,
  todayISO,
} from '../utils/dates';
import { STATUS_COLORS } from '../utils/tree';
import { textOn } from '../theme';
import { pageZoom } from '../store';

export interface GanttRow {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  status: Status;
  summary: boolean;
  progress: number;
  color?: string;
  label?: string;
  editable: boolean;
}

export type Scale = 'day' | 'week' | 'month';

export const DAY_WIDTH: Record<Scale, number> = { day: 26, week: 10, month: 3.6 };

/** larghezza di un giorno in pixel; `factor` è l'ingrandimento scelto dall'utente */
export const dayWidth = (scale: Scale, factor = 1) => DAY_WIDTH[scale] * factor;

interface Props {
  rows: GanttRow[];
  scale: Scale;
  lang: Lang;
  rowHeight: number;
  /** ingrandimento della larghezza dei giorni (1 = normale) */
  dayFactor?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onChangeDates: (id: string, start: string, end: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  minHeight?: number;
  paneStyle?: React.CSSProperties;
  /** giorni da evidenziare come non disponibili (assenze) */
  blockedDays?: Set<string>;
}

interface DragState {
  id: string;
  mode: 'move' | 'start' | 'end';
  startX: number;
  origStart: string;
  origEnd: string;
  delta: number;
}

export function ganttRange(rows: GanttRow[], scale: Scale): { start: string; days: number } {
  let min: string | null = null;
  let max: string | null = null;
  for (const r of rows) {
    if (r.start && (!min || r.start < min)) min = r.start;
    if (r.end && (!max || r.end > max)) max = r.end;
  }
  const today = todayISO();
  // l'intervallo comprende sempre la data odierna, così la linea "oggi" è visibile
  min = min && min < today ? min : today;
  max = max && max > today ? max : today;
  const pad = scale === 'day' ? 5 : scale === 'week' ? 10 : 25;
  // allinea al lunedì per header settimanali coerenti
  const start = startOfWeek(addDays(min, -pad));
  const end = addDays(max, pad);
  const minDays = scale === 'day' ? 45 : scale === 'week' ? 120 : 400;
  const days = Math.max(minDays, diffDays(start, end) + 1);
  return { start, days };
}

export function Gantt({
  rows,
  scale,
  lang,
  rowHeight,
  dayFactor = 1,
  selectedId,
  onSelect,
  onChangeDates,
  scrollRef,
  onScroll,
  minHeight,
  paneStyle,
  blockedDays,
}: Props) {
  const dw = dayWidth(scale, dayFactor);
  const { start: rangeStart, days: totalDays } = React.useMemo(() => ganttRange(rows, scale), [rows, scale]);
  const width = totalDays * dw;
  const today = todayISO();
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const dragRef = React.useRef<DragState | null>(null);

  const x = (iso: string) => diffDays(rangeStart, iso) * dw;
  const todayOffset = diffDays(rangeStart, today);
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays;

  // ------------------------------------------------------------- header
  const header = React.useMemo(() => {
    const top: { left: number; width: number; label: string }[] = [];
    const bottom: { left: number; width: number; label: string; today: boolean; center: boolean }[] = [];
    if (scale === 'month') {
      let cur = rangeStart;
      let year = parseISO(cur).getFullYear();
      let yStart = 0;
      for (let i = 0; i < totalDays; i++) {
        const d = parseISO(cur);
        if (d.getFullYear() !== year) {
          top.push({ left: yStart * dw, width: (i - yStart) * dw, label: String(year) });
          year = d.getFullYear();
          yStart = i;
        }
        if (d.getDate() === 1 || i === 0) {
          const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          const len = dim - d.getDate() + 1; // giorni residui del mese a partire da qui
          bottom.push({
            left: i * dw,
            width: len * dw,
            label: monthName(d, lang, false),
            today: false,
            center: true,
          });
        }
        cur = addDays(cur, 1);
      }
      top.push({ left: yStart * dw, width: (totalDays - yStart) * dw, label: String(year) });
      return { top, bottom };
    }
    // top = mesi
    let cur = rangeStart;
    let mKey = parseISO(cur).getMonth();
    let mStart = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = parseISO(cur);
      if (d.getMonth() !== mKey) {
        const first = parseISO(addDays(rangeStart, mStart));
        top.push({
          left: mStart * dw,
          width: (i - mStart) * dw,
          label: `${monthName(first, lang)} ${first.getFullYear()}`,
        });
        mKey = d.getMonth();
        mStart = i;
      }
      cur = addDays(cur, 1);
    }
    {
      const first = parseISO(addDays(rangeStart, mStart));
      top.push({
        left: mStart * dw,
        width: (totalDays - mStart) * dw,
        label: `${monthName(first, lang)} ${first.getFullYear()}`,
      });
    }
    if (scale === 'day') {
      let c = rangeStart;
      for (let i = 0; i < totalDays; i++) {
        const d = parseISO(c);
        bottom.push({
          left: i * dw,
          width: dw,
          label: String(d.getDate()),
          today: c === today,
          center: true,
        });
        c = addDays(c, 1);
      }
    } else {
      let c = rangeStart;
      for (let i = 0; i < totalDays; i += 7) {
        bottom.push({
          left: i * dw,
          width: 7 * dw,
          label: `${isoWeek(c)}`,
          today: false,
          center: true,
        });
        c = addDays(c, 7);
      }
    }
    return { top, bottom };
  }, [rangeStart, totalDays, dw, scale, lang, today]);

  // ------------------------------------------------------------- weekend / assenze
  const weekends = React.useMemo(() => {
    if (scale === 'month') return [];
    const out: number[] = [];
    let cur = rangeStart;
    for (let i = 0; i < totalDays; i++) {
      if (isWeekend(cur)) out.push(i);
      cur = addDays(cur, 1);
    }
    return out;
  }, [rangeStart, totalDays, scale]);

  const blocked = React.useMemo(() => {
    if (!blockedDays || blockedDays.size === 0) return [];
    const out: number[] = [];
    let cur = rangeStart;
    for (let i = 0; i < totalDays; i++) {
      if (blockedDays.has(cur)) out.push(i);
      cur = addDays(cur, 1);
    }
    return out;
  }, [rangeStart, totalDays, blockedDays]);

  // ------------------------------------------------------------- drag
  React.useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      // il mouse si muove in pixel dello schermo, il grafico può essere ingrandito
      const delta = Math.round((e.clientX - cur.startX) / (dw * pageZoom()));
      if (delta !== cur.delta) {
        const next = { ...cur, delta };
        dragRef.current = next;
        setDrag(next);
      }
    };
    const up = () => {
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!cur || cur.delta === 0) return;
      let s = cur.origStart;
      let e2 = cur.origEnd;
      if (cur.mode === 'move') {
        s = addDays(s, cur.delta);
        e2 = addDays(e2, cur.delta);
      } else if (cur.mode === 'start') {
        s = addDays(s, cur.delta);
        if (s > e2) s = e2;
      } else {
        e2 = addDays(e2, cur.delta);
        if (e2 < s) e2 = s;
      }
      onChangeDates(cur.id, s, e2);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, dw, onChangeDates]);

  const beginDrag = (e: React.PointerEvent, row: GanttRow, mode: DragState['mode']) => {
    if (!row.editable || !row.start || !row.end) return;
    e.preventDefault();
    e.stopPropagation();
    const st: DragState = {
      id: row.id,
      mode,
      startX: e.clientX,
      origStart: row.start,
      origEnd: row.end,
      delta: 0,
    };
    dragRef.current = st;
    setDrag(st);
    onSelect?.(row.id);
  };

  const bodyHeight = Math.max(rows.length * rowHeight, minHeight ?? 0);

  return (
    <div className="gantt-pane" ref={scrollRef} onScroll={onScroll} style={paneStyle}>
      <div className="gantt-inner" style={{ width }}>
        <div className="gantt-head" style={{ width }}>
          <div className="hrow">
            {header.top.map((c, i) => (
              <div key={i} className="hcell" style={{ left: c.left, width: c.width }}>
                {c.label}
              </div>
            ))}
          </div>
          <div className="hrow">
            {header.bottom.map((c, i) => (
              <div
                key={i}
                className={'hcell' + (c.center ? ' center' : '') + (c.today ? ' today-h' : '')}
                style={{ left: c.left, width: c.width }}
              >
                {c.width >= 14 ? c.label : ''}
              </div>
            ))}
          </div>
        </div>

        <div className="gantt-body" style={{ width, height: bodyHeight }}>
          {/* sfondo: weekend + griglia */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                dw >= 8
                  ? `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${dw}px)`
                  : `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${dw * 7}px)`,
              opacity: 0.6,
              pointerEvents: 'none',
            }}
          />
          {weekends.map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * dw,
                width: dw,
                top: 0,
                bottom: 0,
                background: 'var(--weekend)',
                pointerEvents: 'none',
              }}
            />
          ))}
          {blocked.map((i) => (
            <div
              key={'b' + i}
              className="gantt-blocked"
              style={{ position: 'absolute', left: i * dw, width: Math.max(dw, 2), top: 0, bottom: 0 }}
            />
          ))}
          {todayInRange && <div className="gantt-today" style={{ left: x(today) + dw / 2 }} />}

          {rows.map((row, idx) => {
            const isDrag = drag?.id === row.id;
            let s = row.start;
            let e2 = row.end;
            if (isDrag && s && e2 && drag) {
              if (drag.mode === 'move') {
                s = addDays(drag.origStart, drag.delta);
                e2 = addDays(drag.origEnd, drag.delta);
              } else if (drag.mode === 'start') {
                s = addDays(drag.origStart, drag.delta);
                if (s > drag.origEnd) s = drag.origEnd;
                e2 = drag.origEnd;
              } else {
                s = drag.origStart;
                e2 = addDays(drag.origEnd, drag.delta);
                if (e2 < drag.origStart) e2 = drag.origStart;
              }
            }
            const has = !!(s && e2);
            const left = has ? x(s!) : 0;
            const w = has ? (diffDays(s!, e2!) + 1) * dw : 0;
            const color = row.color ?? STATUS_COLORS[row.status];
            return (
              <div
                key={row.id}
                className={'gantt-row' + (selectedId === row.id ? ' sel-row' : '')}
                style={{ top: idx * rowHeight, height: rowHeight, position: 'absolute', left: 0, width }}
                onMouseDown={() => onSelect?.(row.id)}
              >
                {has && (
                  <div
                    className={
                      'bar' +
                      (row.summary ? ' summary' : '') +
                      (isDrag ? ' dragging' : '') +
                      (row.status === 'CANCELLED' ? ' cancelled' : '')
                    }
                    style={{
                      left,
                      width: Math.max(w, 3),
                      background: color,
                      borderColor: color,
                      cursor: row.editable ? undefined : 'default',
                    }}
                    title={`${row.name}${row.label ? ' · ' + row.label : ''}`}
                    onPointerDown={(e) => row.editable && beginDrag(e, row, 'move')}
                  >
                    {!row.summary && row.progress > 0 && (
                      <div className="progress" style={{ width: `${Math.round(row.progress * 100)}%` }} />
                    )}
                    {w > 46 && (
                      <div
                        className={'bar-inner' + (textOn(color) === '#141b24' ? ' ink' : '')}
                        style={{ color: textOn(color) }}
                      >
                        {row.name}
                      </div>
                    )}
                    {row.editable && (
                      <>
                        <div className="handle l" onPointerDown={(e) => beginDrag(e, row, 'start')} />
                        <div className="handle r" onPointerDown={(e) => beginDrag(e, row, 'end')} />
                      </>
                    )}
                    {row.label && <div className="bar-label">{row.label}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
