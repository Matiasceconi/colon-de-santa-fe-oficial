import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { scaleColor, painColor, sleepColor, PILL_CLASSES, LEGEND } from '@/components/internalLoad/wellnessColors';
import WellnessPlayerDetailModal from '@/components/internalLoad/WellnessPlayerDetailModal';

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T12:00:00');
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
}

const V2_COLS = [
  { key: 'fatigue', label: 'Fatiga', type: 'scale', sort: 'fatigue_desc' },
  { key: 'muscular_soreness', label: 'C. muscular', type: 'scale', sort: 'muscular_desc' },
  { key: 'sleep_lack', label: 'Descanso', type: 'scale', sort: 'sleep_lack_desc' },
  { key: 'stress', label: 'Estrés', type: 'scale', sort: 'stress_desc' },
  { key: 'mood_low', label: 'Ánimo', type: 'scale', sort: 'index_desc' },
  { key: 'sleep_hours', label: 'Sueño', type: 'sleep', sort: 'sleep_asc' },
  { key: 'pain_intensity', label: 'Dolor', type: 'pain', sort: 'pain_desc' },
];

const SORT_OPTIONS = [
  { value: 'index_desc', label: 'Peor estado general' },
  { value: 'fatigue_desc', label: 'Mayor fatiga' },
  { value: 'muscular_desc', label: 'Mayor cansancio muscular' },
  { value: 'stress_desc', label: 'Mayor estrés' },
  { value: 'sleep_lack_desc', label: 'Peor descanso' },
  { value: 'pain_desc', label: 'Mayor dolor' },
  { value: 'sleep_asc', label: 'Menos horas de sueño' },
  { value: 'time_desc', label: 'Hora de respuesta' },
];

function Pill({ value, colorKey, suffix }) {
  if (value == null || value === '') {
    return <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold bg-zinc-800/60 text-zinc-600 border border-zinc-700">—</span>;
  }
  return (
    <span className={`inline-flex items-center justify-center min-w-8 h-8 px-1.5 rounded-full text-xs font-bold ${PILL_CLASSES[colorKey]}`}>
      {value}{suffix}
    </span>
  );
}

function scoreTextClass(colorKey) {
  if (colorKey === 'green') return 'text-emerald-400';
  if (colorKey === 'yellow') return 'text-yellow-400';
  if (colorKey === 'orange') return 'text-orange-400';
  if (colorKey === 'red') return 'text-red-400';
  return 'text-zinc-500';
}

const ALERT_COLOR = {
  verde: 'green',
  amarillo: 'yellow',
  naranja: 'orange',
  rojo: 'red',
};

export default function WellnessDailyTab({ wellness, players, date, onDateChange }) {
  const [search, setSearch] = useState('');
  const [filterAlert, setFilterAlert] = useState('Todos');
  const [sort, setSort] = useState('index_desc');
  const [sortDir, setSortDir] = useState('desc');
  const [selected, setSelected] = useState(null);

  const byPlayerToday = useMemo(() => {
    const m = {};
    wellness.filter((w) => w.response_date === date).forEach((w) => { m[w.player_id] = w; });
    return m;
  }, [wellness, date]);

  const rows = useMemo(() => {
    let list = players
      .map((p) => ({ player: p, w: byPlayerToday[p.id] }))
      .filter(({ player }) => `${player.first_name} ${player.last_name}`.toLowerCase().includes(search.toLowerCase()))
      .filter(({ w }) => filterAlert === 'Todos' || (w && w.alert_level === filterAlert));

    const dir = sortDir === 'desc' ? -1 : 1;
    const num = (v) => (v == null ? null : Number(v));
    list = [...list].sort((a, b) => {
      const wa = a.w, wb = b.w;
      const cmp = (va, vb) => {
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return va - vb;
      };
      switch (sort) {
        case 'index_desc': return cmp(num(wa?.wellness_score), num(wb?.wellness_score)) * dir;
        case 'fatigue_desc': return cmp(num(wa?.fatigue), num(wb?.fatigue)) * dir;
        case 'muscular_desc': return cmp(num(wa?.muscular_soreness), num(wb?.muscular_soreness)) * dir;
        case 'stress_desc': return cmp(num(wa?.stress), num(wb?.stress)) * dir;
        case 'sleep_lack_desc': return cmp(num(wa?.sleep_lack), num(wb?.sleep_lack)) * dir;
        case 'pain_desc': return cmp(wa?.has_pain ? num(wa.pain_intensity) : 0, wb?.has_pain ? num(wb.pain_intensity) : 0) * dir;
        case 'sleep_asc': return cmp(num(wa?.sleep_hours), num(wb?.sleep_hours)) * dir;
        case 'time_desc': return cmp(wa?.submitted_at ? new Date(wa.submitted_at).getTime() : 0, wb?.submitted_at ? new Date(wb.submitted_at).getTime() : 0) * dir;
        default: return 0;
      }
    });
    return list;
  }, [players, byPlayerToday, search, filterAlert, sort, sortDir]);

  const summary = useMemo(() => {
    const active = players.length;
    const responded = players.filter((p) => byPlayerToday[p.id]).length;
    const v2Scores = players.map((p) => byPlayerToday[p.id]).filter((w) => w?.wellness_scale_version === 'negative_1_10_v2' && w.wellness_score != null);
    const avg = v2Scores.length ? Math.round((v2Scores.reduce((a, w) => a + w.wellness_score, 0) / v2Scores.length) * 10) / 10 : null;
    const red = players.filter((p) => byPlayerToday[p.id]?.alert_level === 'rojo').length;
    const orange = players.filter((p) => byPlayerToday[p.id]?.alert_level === 'naranja').length;
    const yellow = players.filter((p) => byPlayerToday[p.id]?.alert_level === 'amarillo').length;
    const pain = players.filter((p) => byPlayerToday[p.id]?.has_pain).length;
    const lowSleep = players.filter((p) => { const h = byPlayerToday[p.id]?.sleep_hours; return h && h < 6; }).length;
    return { active, responded, pct: active ? Math.round((responded / active) * 100) : 0, avg, red, orange, yellow, pain, lowSleep };
  }, [players, byPlayerToday]);

  const cards = [
    { label: 'Activos', value: summary.active, color: 'text-white' },
    { label: 'Respondieron', value: summary.responded, color: 'text-emerald-400' },
    { label: 'Respuesta', value: `${summary.pct}%`, color: 'text-emerald-400' },
    { label: 'Índice prom.', value: summary.avg ?? '-', color: scoreTextClass(summary.avg == null ? 'gray' : scaleColor(summary.avg)) },
    { label: 'Alertas rojas', value: summary.red, color: 'text-red-400' },
    { label: 'Alertas naranjas', value: summary.orange, color: 'text-orange-400' },
    { label: 'Alertas amar.', value: summary.yellow, color: 'text-yellow-400' },
    { label: 'Con dolor', value: summary.pain, color: 'text-amber-400' },
    { label: 'Poco sueño', value: summary.lowSleep, color: 'text-red-400' },
  ];

  function toggleSort(val) {
    if (sort === val) { setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')); }
    else { setSort(val); setSortDir('desc'); }
  }

  function sortIndicator(activeSort) {
    if (sort !== activeSort) return null;
    return sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Índice de fatiga y malestar</h2>
        <p className="text-sm text-zinc-500">Wellness diario · escala 1-10 (1 = mejor estado, 10 = peor estado)</p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
            <p className="text-[11px] text-zinc-500 leading-tight">{c.label}</p>
            <p className={`text-xl font-black mt-0.5 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-zinc-500 font-semibold uppercase">Leyenda:</span>
        {LEGEND.map((l) => (
          <span key={l.color} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-full ${PILL_CLASSES[l.color]}`} />
            <span className="text-zinc-400">{l.label}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
        <select value={filterAlert} onChange={(e) => setFilterAlert(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white">
          <option value="Todos">Todas las alertas</option>
          <option value="rojo">Roja</option>
          <option value="naranja">Naranja</option>
          <option value="amarillo">Amarilla</option>
          <option value="verde">Verde</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white">
          {SORT_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar jugador..." className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px] border-separate border-spacing-0">
          <thead className="text-zinc-400 text-xs uppercase">
            <tr>
              <th className="sticky left-0 z-10 bg-zinc-900 text-left p-3 font-semibold w-40 min-w-[10rem]">Jugador</th>
              <th className="sticky left-[10rem] z-10 bg-zinc-900 text-left p-3 font-semibold w-24">Pos.</th>
              {V2_COLS.map((c) => (
                <th key={c.key} className="text-center p-3 font-semibold cursor-pointer hover:text-white" onClick={() => toggleSort(c.sort)}>
                  <span className="inline-flex items-center gap-0.5">{c.label}{sortIndicator(c.sort)}</span>
                </th>
              ))}
              <th className="text-center p-3 font-semibold cursor-pointer hover:text-white" onClick={() => toggleSort('index_desc')}>
                <span className="inline-flex items-center gap-0.5">Índice {sortIndicator('index_desc')}</span>
              </th>
              <th className="text-center p-3 font-semibold">Hora</th>
              <th className="text-center p-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, w }) => {
              const isV2 = w?.wellness_scale_version === 'negative_1_10_v2';
              return (
                <tr key={player.id} className="hover:bg-zinc-900/50 cursor-pointer" onClick={() => setSelected({ player, w })}>
                  <td className="sticky left-0 z-10 bg-zinc-950 p-3 font-medium text-white border-b border-zinc-800">{player.first_name} {player.last_name}</td>
                  <td className="sticky left-[10rem] z-10 bg-zinc-950 p-3 text-zinc-400 text-xs border-b border-zinc-800">{player.position || '-'}</td>
                  {V2_COLS.map((c) => {
                    const val = isV2 ? w[c.key] : null;
                    let colorKey;
                    if (c.type === 'sleep') colorKey = sleepColor(val);
                    else if (c.type === 'pain') colorKey = isV2 && w.has_pain ? painColor(val) : (isV2 ? 'green' : 'gray');
                    else colorKey = scaleColor(val);
                    const suffix = c.type === 'sleep' ? 'h' : '';
                    return (<td key={c.key} className="p-3 text-center border-b border-zinc-800"><Pill value={val} colorKey={colorKey} suffix={suffix} /></td>);
                  })}
                  <td className="p-3 text-center border-b border-zinc-800">
                    {w ? <Pill value={w.wellness_score} colorKey={scaleColor(w.wellness_score)} /> : <Pill value={null} colorKey="gray" />}
                  </td>
                  <td className="p-3 text-center text-zinc-500 text-xs border-b border-zinc-800">{w?.submitted_at ? new Date(w.submitted_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td className="p-3 text-center border-b border-zinc-800">
                    {w ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${PILL_CLASSES[ALERT_COLOR[w.alert_level] || 'gray']}`}>
                        {w.alert_level === 'rojo' ? 'Roja' : w.alert_level === 'naranja' ? 'Naranja' : w.alert_level === 'amarillo' ? 'Amar.' : 'Verde'}
                      </span>
                    ) : <span className="text-xs text-zinc-600">Pendiente</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-8 text-center text-zinc-500 text-sm">No hay jugadores que coincidan</div>}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Info size={13} />
        <span>Tocá un jugador para ver el detalle completo de su respuesta.</span>
      </div>

      {selected && <WellnessPlayerDetailModal player={selected.player} wellness={selected.w} onClose={() => setSelected(null)} />}
    </div>
  );
}