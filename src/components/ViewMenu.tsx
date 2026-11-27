import React from 'react';
import { createPortal } from 'react-dom';
import { CHART_LIMITS, PAGES, ZOOM_LIMITS, defaultChart, defaultZoom, setUi, useStore } from '../store';
import { IconZoom, useT } from '../ui';
import type { Page } from '../types';
import type { TKey } from '../i18n';

const PRESET_ZOOM = [1, 1.25, 1.5, 1.75];
const STEP = 0.1;
/** pagine con un grafico Gantt */
const WITH_CHART: Page[] = ['home', 'project', 'load'];

const round = (v: number) => Math.round(v * 100) / 100;
const percent = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Menù «Zoom» della barra in alto: ingrandisce testo e dettagli della pagina aperta, il
 * grafico Gantt e, a parte, i menù. Sono preferenze personali di questo browser.
 */
export function ViewMenu() {
  const { ui } = useStore();
  const { t } = useT();
  const [pos, setPos] = React.useState<{ right: number; top: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const open = !!pos;
  const page = ui.page;
  const zoom = ui.zoom[page];

  const setPageZoom = (value: number) =>
    setUi({ zoom: { ...ui.zoom, [page]: round(Math.min(ZOOM_LIMITS.page[1], Math.max(ZOOM_LIMITS.page[0], value))) } });

  React.useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setPos(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    const close = () => setPos(null);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setPos(null);
      return;
    }
    const r = buttonRef.current!.getBoundingClientRect();
    setPos({ right: Math.max(8, window.innerWidth - r.right - 60), top: r.bottom + 6 });
  };

  const allSame = PAGES.every((p) => ui.zoom[p] === zoom);
  const untouched =
    PAGES.every((p) => ui.zoom[p] === 1) &&
    ui.menuZoom === 1 &&
    ui.chart.rowHeight === defaultChart.rowHeight &&
    ui.chart.dayWidth === defaultChart.dayWidth;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'tool' + (open ? ' on' : '')}
        onClick={toggle}
        title={t('view.title')}
        aria-expanded={open}
      >
        <IconZoom />
        <span className="lbl">{zoom === 1 ? t('view.button') : percent(zoom)}</span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            className="view-menu"
            style={{ right: pos.right, top: pos.top, maxHeight: `calc(100vh - ${pos.top + 10}px)` }}
            role="dialog"
            aria-label={t('view.title')}
          >
            <div className="view-title">{t('view.title')}</div>

            <div className="io-label">{t('view.page', { page: t(`nav.${page}` as TKey) })}</div>
            <div className="zoom-line">
              <button
                type="button"
                className="btn zoom-step"
                onClick={() => setPageZoom(zoom - STEP)}
                disabled={zoom <= ZOOM_LIMITS.page[0]}
                title={t('view.smaller')}
              >
                A−
              </button>
              <input
                type="range"
                min={ZOOM_LIMITS.page[0]}
                max={ZOOM_LIMITS.page[1]}
                step={0.05}
                value={zoom}
                aria-label={t('view.page', { page: t(`nav.${page}` as TKey) })}
                onChange={(e) => setPageZoom(Number(e.target.value))}
              />
              <button
                type="button"
                className="btn zoom-step big"
                onClick={() => setPageZoom(zoom + STEP)}
                disabled={zoom >= ZOOM_LIMITS.page[1]}
                title={t('view.bigger')}
              >
                A+
              </button>
              <b>{percent(zoom)}</b>
            </div>
            <div className="segmented">
              {PRESET_ZOOM.map((v) => (
                <button key={v} type="button" className={zoom === v ? 'active' : ''} onClick={() => setPageZoom(v)}>
                  {percent(v)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={allSame}
              onClick={() => setUi({ zoom: Object.fromEntries(PAGES.map((p) => [p, zoom])) as Record<Page, number> })}
            >
              {t('view.allPages')}
            </button>

            {WITH_CHART.includes(page) && (
              <>
                <div className="io-label">{t('view.chart')}</div>
                <Slider
                  label={t('view.rowHeight')}
                  value={ui.chart.rowHeight}
                  min={CHART_LIMITS.rowHeight[0]}
                  max={CHART_LIMITS.rowHeight[1]}
                  step={2}
                  text={`${ui.chart.rowHeight} px`}
                  onChange={(rowHeight) => setUi({ chart: { ...ui.chart, rowHeight } })}
                />
                <Slider
                  label={t('view.dayWidth')}
                  value={ui.chart.dayWidth}
                  min={CHART_LIMITS.dayWidth[0]}
                  max={CHART_LIMITS.dayWidth[1]}
                  step={0.1}
                  text={percent(ui.chart.dayWidth)}
                  onChange={(dayWidth) => setUi({ chart: { ...ui.chart, dayWidth: round(dayWidth) } })}
                />
              </>
            )}

            <div className="io-label">{t('view.menus')}</div>
            <Slider
              label={t('view.menusSize')}
              value={ui.menuZoom}
              min={ZOOM_LIMITS.menu[0]}
              max={ZOOM_LIMITS.menu[1]}
              step={0.05}
              text={percent(ui.menuZoom)}
              onChange={(menuZoom) => setUi({ menuZoom: round(menuZoom) })}
            />

            <div className="view-foot">
              <button
                type="button"
                className="btn sm"
                disabled={untouched}
                onClick={() => setUi({ zoom: defaultZoom(), menuZoom: 1, chart: defaultChart })}
              >
                {t('view.reset')}
              </button>
              <span className="hint">{t('view.personal')}</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {label}
        <b>{text}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
