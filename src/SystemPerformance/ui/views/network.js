// Network tab: throughput per adapter, latency, jitter and loss to your router (and, opt-in, to the
// internet), the Wi-Fi link (standard, band, channel, rates) and the adapter's addresses.

import { h } from '../dom.js';
import { icon as glyph, switchInput } from '../kit.js';
import { bits, bytes, niceMax } from '../metrics.js';
import { statRow, chartCard, draw, specCard, picker, stats, text, fill } from './detail.js';

export const id = 'network';
export const title = 'Network';
export const tile = 'var(--cat-2)';
export const icon = () => glyph('wifi');

let selected = null;   // adapter id
let ui = null;

const card = (titleText, ...body) => h('article', { class: 'ts-card' }, h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);
const ms = v => (v == null ? '—' : `${v} ms`);

export function render(el, ctx) {
  const { animate } = ctx;
  ctx.actions.watchNetwork(true);
  const nets = ctx.sample?.nets ?? [];
  if (!nets.some(n => n.id === selected)) selected = nets.find(n => n.primary)?.id ?? nets[0]?.id ?? null;
  const n = nets.find(x => x.id === selected);

  const sr = statRow([{ key: 'rx', label: 'Download' }, { key: 'tx', label: 'Upload' }, { key: 'ping', label: 'Router latency' }, { key: 'link', label: n?.wireless ? 'Signal' : 'Link speed' }], animate);
  const traffic = chartCard('Throughput', ['var(--cat-2)', 'var(--cat-6)'], 'Network receive and send, last 60 seconds', { size: 'tall', animate, legendItems: [['Receive', 'var(--cat-2)'], ['Send', 'var(--cat-6)']] });
  const latency = chartCard('Latency', ['var(--cat-4)', 'var(--cat-5)'], 'Round-trip time to the router and the internet, last 60 seconds',
    { animate, legendItems: ctx.settings.pingInternet ? [['Router', 'var(--cat-4)'], ['Internet (1.1.1.1)', 'var(--cat-5)']] : [['Router', 'var(--cat-4)']] });
  const lat = stats({ routerAvg: 'Router average', routerJitter: 'Router jitter', routerLoss: 'Router loss', netAvg: 'Internet average', netJitter: 'Internet jitter', netLoss: 'Internet loss' });
  latency.card.append(lat.el, h('div', { class: 'ts-row' },
    h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, 'Ping the internet'),
      h('span', { class: 'ts-row-subtitle' }, 'Sends a ping to Cloudflare (1.1.1.1) once a second while this tab is open. Off by default.')),
    h('span', { class: 'ts-row-trailing' }, switchInput({ label: 'Ping the internet', checked: ctx.settings.pingInternet, onChange: v => { ctx.actions.setSetting('pingInternet', v); ctx.actions.navigate(id); } }))));

  const totals = { rx: text(), tx: text() };
  const det = n?.details ?? {};
  const details = specCard('Adapter', [
    ['Name', n?.name], ['Description', n?.description], ['Type', ({ Wireless80211: 'Wi-Fi', Ethernet: 'Ethernet', GigabitEthernet: 'Ethernet' })[det.type] ?? det.type], ['MAC address', det.mac],
    ['IPv4', det.ipv4], ['IPv6', det.ipv6], ['Gateway', det.gateway], ['DNS servers', det.dns],
    ['DHCP', det.dhcp == null ? null : det.dhcp ? 'Yes' : 'No (static)'], ['Link speed', n?.linkMbps ? `${n.linkMbps.toLocaleString()} Mbps` : null],
    ['Received since boot', totals.rx], ['Sent since boot', totals.tx],
  ], animate);
  const wifiNodes = { ssid: text(), signal: text(), standard: text(), band: text(), channel: text(), rx: text(), tx: text() };
  const wifi = n?.wireless ? specCard('Wi-Fi', [
    ['Network', wifiNodes.ssid], ['Signal', wifiNodes.signal], ['Standard', wifiNodes.standard], ['Band', wifiNodes.band],
    ['Channel', wifiNodes.channel], ['Receive rate', wifiNodes.rx], ['Transmit rate', wifiNodes.tx],
  ], animate) : null;

  fill(el,
    nets.length > 1 ? picker('Adapter', nets.map(x => ({ value: x.id, label: x.name })), selected, v => { selected = v; ctx.actions.navigate(id); }) : null,
    sr.el,
    h('div', { class: 'ts-grid ts-grid--halves' }, traffic.card, latency.card),
    h('div', { class: 'ts-grid ts-grid--halves' }, details, wifi ?? card('Wi-Fi', h('p', { class: 'ts-list-footer' }, 'This adapter is wired.'))));
  ui = { el, sr, traffic, latency, lat, totals, wifiNodes, wireless: !!n?.wireless };
  if (ctx.sample) update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchNetwork(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el || !ctx.sample) return;
  const n = (ctx.sample.nets ?? []).find(x => x.id === selected);
  const p = ctx.sample.ping;
  if (n) {
    ui.sr.value.rx.set(bits(n.rx));
    ui.sr.meta.rx.set(`Peak ${bits(ctx.series(`net:${n.id}/rx`).max())}`);
    ui.sr.value.tx.set(bits(n.tx));
    ui.sr.meta.tx.set(`Peak ${bits(ctx.series(`net:${n.id}/tx`).max())}`);
    ui.sr.value.link.set(n.wireless ? (n.signal != null ? `${n.signal}%` : '—') : n.linkMbps ? `${n.linkMbps.toLocaleString()} Mbps` : '—');
    ui.sr.meta.link.set(n.wireless ? (n.wifi?.standard ?? '') : '');
    draw(ui.traffic.chart, ctx, [`net:${n.id}/rx`, `net:${n.id}/tx`], peak => niceMax(peak, 1000));
    ui.traffic.meta.set(`↓ ${bits(n.rx)}  ↑ ${bits(n.tx)}`);
    ui.totals.rx.set(bytes(n.totalRx));
    ui.totals.tx.set(bytes(n.totalTx));
    if (ui.wireless) {
      const w = n.wifi ?? {};
      ui.wifiNodes.ssid.set(w.ssid || 'Hidden (allow location access)');
      ui.wifiNodes.signal.set(w.signal != null ? `${w.signal}%` : '—');
      ui.wifiNodes.standard.set(w.standard ?? '—');
      ui.wifiNodes.band.set(w.band ?? '—');
      ui.wifiNodes.channel.set(w.channel != null ? String(w.channel) : '—');
      ui.wifiNodes.rx.set(w.rxMbps ? `${w.rxMbps} Mbps` : '—');
      ui.wifiNodes.tx.set(w.txMbps ? `${w.txMbps} Mbps` : '—');
    }
  }
  ui.sr.value.ping.set(p?.router?.avg != null ? `${p.router.avg} ms` : '—');
  ui.sr.meta.ping.set(p?.router ? `Jitter ${p.router.jitter} ms · loss ${p.router.loss}%` : p?.gateway === null ? 'No gateway' : 'Measuring…');
  draw(ui.latency.chart, ctx, ctx.settings.pingInternet ? ['ping:router', 'ping:internet'] : ['ping:router'], peak => niceMax(peak, 10));
  ui.latency.meta.set(p?.gateway ? `Router ${p.gateway}` : '');
  ui.lat.routerAvg.set(ms(p?.router?.avg)); ui.lat.routerJitter.set(ms(p?.router?.jitter)); ui.lat.routerLoss.set(p?.router ? `${p.router.loss}%` : '—');
  ui.lat.netAvg.set(ctx.settings.pingInternet ? ms(p?.internet?.avg) : 'Off');
  ui.lat.netJitter.set(ctx.settings.pingInternet ? ms(p?.internet?.jitter) : 'Off');
  ui.lat.netLoss.set(ctx.settings.pingInternet && p?.internet ? `${p.internet.loss}%` : ctx.settings.pingInternet ? '—' : 'Off');
}
