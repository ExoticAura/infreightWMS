'use strict';
/* Infreight WMS — frontend (talks to /api). */

const TOKEN_KEY = 'infreight_token';
const fmt = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmt0 = (n) => (n == null || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const API = {
  token: () => localStorage.getItem(TOKEN_KEY),
  async req(path, opts = {}) {
    const headers = opts.headers || {};
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const t = API.token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch('/api' + path, { ...opts, headers, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); WMS.boot(); throw new Error('Session expired'); }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
    return res.json();
  },
  async blob(path) {
    const t = API.token();
    const res = await fetch('/api' + path, { headers: t ? { Authorization: 'Bearer ' + t } : {} });
    if (!res.ok) throw new Error('Download failed');
    return res.blob();
  },
};

const PAGEMETA = {
  dashboard: { ic: '▦', name: 'Dashboard', crumb: 'Overview of warehouse activity' },
  inbound: { ic: '⬇', name: 'Inbound', crumb: 'Receive: CIPL (expected) + GRN (confirm + bin)' },
  outbound: { ic: '⬆', name: 'Outbound', crumb: 'Pick, auto-deduct & export packing list' },
  stock: { ic: '▤', name: 'Stock Ledger', crumb: 'Perpetual balance by SKU' },
  locations: { ic: '▩', name: 'Bin Locations', crumb: 'Warehouse map & occupancy' },
  skus: { ic: '☰', name: 'SKU Master', crumb: 'Items & conversion factors' },
  audit: { ic: '◷', name: 'Audit Trail', crumb: 'Every stock movement, who & when' },
  users: { ic: '⚇', name: 'Users', crumb: 'Accounts & roles (admin)' },
  about: { ic: 'ⓘ', name: 'System & Flow', crumb: 'How the WMS works' },
};
const ROLE_PAGES = {
  ADMIN: ['dashboard', 'inbound', 'outbound', 'stock', 'locations', 'skus', 'audit', 'users', 'about'],
  OPS: ['dashboard', 'inbound', 'outbound', 'stock', 'locations', 'skus', 'audit', 'about'],
};
const GROUPS = [['Overview', ['dashboard']], ['Operations', ['inbound', 'outbound', 'stock', 'locations']], ['Admin', ['skus', 'audit', 'users', 'about']]];

const S = {}; // client cache

const WMS = {
  user: null, page: 'dashboard',

  async boot() {
    if (!API.token()) return this.renderLogin();
    try {
      const me = await API.req('/me'); this.user = me.user;
      await this.loadAll(); this.render();
    } catch (e) { this.renderLogin(); }
  },

  renderLogin(err) {
    document.getElementById('root').innerHTML = `
    <div class="login"><div class="box">
      <h1>Infreight WMS</h1>
      <div class="sub">Bonded Warehouse · BW1292</div>
      <div class="field"><label>Email</label><input id="email" type="email" placeholder="you@infreight.local" value=""></div>
      <div class="field"><label>Password</label><input id="password" type="password" placeholder="••••••••"></div>
      <button class="btn" style="width:100%" onclick="WMS.login()">Sign in</button>
      <div class="err" id="loginErr">${esc(err || '')}</div>
    </div></div>`;
    const pw = document.getElementById('password');
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') WMS.login(); });
  },
  async login() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try {
      const r = await API.req('/login', { method: 'POST', body: { email, password } });
      localStorage.setItem(TOKEN_KEY, r.token); this.user = r.user;
      await this.loadAll(); this.render();
    } catch (e) { document.getElementById('loginErr').textContent = e.message; }
  },
  logout() { localStorage.removeItem(TOKEN_KEY); this.user = null; this.renderLogin(); },
  can(p) { return ROLE_PAGES[this.user.role].includes(p); },

  async loadAll() {
    const [accounts, skus, inbound, issues, stock, audit] = await Promise.all([
      API.req('/accounts'), API.req('/skus'), API.req('/inbound'),
      API.req('/outbound'), API.req('/stock'), API.req('/audit'),
    ]);
    S.accounts = accounts; S.accMap = Object.fromEntries(accounts.map((a) => [a.code, a]));
    S.skus = skus; S.skuMap = Object.fromEntries(skus.map((s) => [s.sku, s]));
    S.inbound = inbound; S.issues = issues; S.stock = stock; S.audit = audit;
  },
  async reload() { await this.loadAll(); this.render(); },

  go(id) { if (!this.can(id)) return; this.page = id; this.render(); },

  render() {
    const pending = S.inbound.filter((s) => s.status === 'Pending review').length;
    const nav = GROUPS.map(([g, ids]) => {
      const links = ids.filter((id) => this.can(id)).map((id) => {
        const m = PAGEMETA[id]; const badge = (id === 'inbound' && pending) ? `<span class="cnt">${pending}</span>` : '';
        return `<a class="${id === this.page ? 'active' : ''}" onclick="WMS.go('${id}')"><span class="ic">${m.ic}</span>${m.name}${badge}</a>`;
      }).join('');
      return links ? `<div class="grp">${g}</div>${links}` : '';
    }).join('');
    const m = PAGEMETA[this.page];
    document.getElementById('root').innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><h1>Infreight WMS</h1><div class="sub">Bonded Warehouse · BW1292</div></div>
        <nav>${nav}</nav>
        <div class="sb-foot"><span class="av">${esc((this.user.name || 'U').slice(0, 2).toUpperCase())}</span>
          <div style="flex:1"><div style="color:var(--text)">${esc(this.user.name)}</div>${this.user.role === 'ADMIN' ? 'Administrator' : 'Warehouse / Ops'}</div>
          <a onclick="WMS.logout()">Sign out</a></div>
      </aside>
      <main>
        <div class="topbar">
          <div><h2>${m.name}</h2><div class="crumb">${m.crumb}</div></div>
          <div class="spacer"></div>
          <div class="search">
            <input id="globalSearch" placeholder="Search GI, CIPL, GR, T251, SKU, stock…" autocomplete="off"
              oninput="WMS.search()" onkeydown="if(event.key==='Escape')WMS.closeSearch()">
            <div class="sresults" id="sresults"></div>
          </div>
          ${this.actionBtn()}
        </div>
        <div class="content" id="view"></div>
      </main>
    </div>`;
    document.getElementById('view').innerHTML = (this['view_' + this.page] || (() => ''))();
    if (this.page === 'stock') this._fillStock();
  },

  actionBtn() {
    let html = `<button class="btn ghost sm" onclick="WMS.exportDraco()">⤓ Export to DRACO</button>`;
    if (this.page === 'inbound') html += ` <button class="btn sm" onclick="WMS.newInbound()">+ New inbound</button>`;
    if (this.page === 'outbound') html += ` <button class="btn sm" onclick="WMS.newIssue()">+ New pick</button>`;
    if (this.page === 'users') html += ` <button class="btn sm" onclick="WMS.newUser()">+ New user</button>`;
    return html;
  },

  /* ---------- DASHBOARD ---------- */
  view_dashboard() {
    const led = S.stock;
    const totPcs = led.reduce((a, r) => a + Number(r.closing), 0);
    const totCbm = led.reduce((a, r) => a + Math.max(0, Number(r.cbm)), 0);
    const pending = S.inbound.filter((s) => s.status === 'Pending review');
    const varic = S.inbound.filter((s) => s.hasVariance);
    const movements = [
      ...S.inbound.filter((s) => s.status === 'Booked').map((s) => ({ d: s.received_date, t: 'IN', ref: s.id, who: (S.accMap[s.account] || {}).name, qty: s.expectedTotal })),
      ...S.issues.map((i) => ({ d: i.issue_date, t: 'OUT', ref: i.id, who: (S.accMap[i.account] || {}).name, qty: i.lines.reduce((a, l) => a + Number(l.qty), 0) })),
    ].sort((a, b) => String(b.d).localeCompare(String(a.d)));
    const occ = this.occupancy(); const used = Object.keys(occ).length; const cap = 48;
    return `
    <div class="row" style="margin-bottom:18px">
      ${kpi('On-hand stock', fmt0(totPcs) + ' pcs', 'across ' + led.filter((r) => Number(r.closing) !== 0).length + ' active SKUs')}
      ${kpi('Storage volume', fmt(totCbm) + ' CBM', 'billable warehouse space')}
      ${kpi('Pending inbound', pending.length, pending.length ? 'awaiting reconciliation' : 'all booked')}
      ${kpi('Doc variances', varic.length, 'GRN vs CIPL')}
    </div>
    <div class="row">
      <div class="card" style="flex:2;min-width:430px">
        <div class="hd"><h3>Recent movements</h3></div>
        <div class="bd" style="padding:0"><table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Account</th><th class="num">Qty (pcs)</th></tr></thead>
        <tbody>${movements.map((mv) => `<tr><td>${esc(mv.d)}</td>
          <td><span class="pill ${mv.t === 'IN' ? 'green' : 'blue'}">${mv.t === 'IN' ? '▼ Inbound' : '▲ Outbound'}</span></td>
          <td><span class="tag">${esc(mv.ref)}</span></td><td>${esc(mv.who)}</td><td class="num">${fmt0(mv.qty)}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="card" style="flex:1;min-width:280px">
        <div class="hd"><h3>Needs attention</h3></div>
        <div class="bd">
          ${pending.map((s) => `<div style="margin-bottom:10px"><span class="pill amber">Pending review</span>
            <span class="tag">${esc(s.id)}</span> CIPL ${esc(s.cipl_no)}<br>
            <span class="muted" style="font-size:12px">CIPL expected ${fmt0(s.expectedTotal)} vs GRN ${fmt0(s.actualTotal)} pcs.
            <a style="color:var(--accent);cursor:pointer" onclick="WMS.go('inbound')">Reconcile →</a></span></div>`).join('') || '<div class="muted">No pending inbound.</div>'}
          <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
          <div class="muted" style="font-size:12px;margin-bottom:6px">Location utilisation</div>
          <div class="bar"><span style="width:${Math.min(100, used / cap * 100)}%"></span></div>
          <div class="muted" style="font-size:12px;margin-top:6px">${used} of ~${cap} bins occupied</div>
        </div>
      </div>
    </div>`;
  },

  /* ---------- INBOUND ---------- */
  view_inbound() {
    return `<div class="note" style="margin-bottom:16px">
      <b>Two-document inbound:</b> the customer sends a <b>CIPL</b> (expected qty); ULD issues the <b>GRN</b> (actual + bin). Stock books on the <b>CIPL</b> quantity; GRN differences are flagged.</div>
    ${S.inbound.map((sh) => {
      const booked = sh.status === 'Booked';
      return `<div class="card" style="margin-bottom:16px">
        <div class="hd"><h3>${esc(sh.id)}</h3>
          <span class="pill ${booked ? 'green' : 'amber'}">${esc(sh.status)}</span>
          ${sh.hasVariance ? '<span class="pill red">Variance</span>' : '<span class="pill green">Docs match</span>'}
          <span class="spacer" style="flex:1"></span>
          <span class="muted" style="font-size:12px">CIPL <span class="tag">${esc(sh.cipl_no)}</span> · PO <span class="tag">${esc(sh.po)}</span> · ${esc((S.accMap[sh.account] || {}).name)}</span>
        </div>
        <div class="bd" style="padding:8px 16px 0"><span class="muted" style="font-size:12px">Shipper: ${esc(sh.shipper)} · Vessel ${esc(sh.vessel)} · ETA ${esc(sh.eta)} · Permit <span class="tag">${esc(sh.permit)}</span></span></div>
        <div class="bd" style="padding:12px 0 0"><table><thead><tr><th>SKU</th><th>Description</th>
          <th class="num">CIPL expected</th><th class="num">GRN actual</th><th class="num">Variance</th><th class="num">Booked</th><th>Bin(s)</th></tr></thead>
        <tbody>${sh.recon.map((r) => { const s = S.skuMap[r.sku] || {};
          return `<tr><td><span class="tag">${esc(r.sku)}</span></td><td>${esc(s.descr)}</td>
          <td class="num">${fmt0(r.expected)}</td><td class="num">${fmt0(r.actual)}</td>
          <td class="num ${r.variance < 0 ? 'neg' : r.variance > 0 ? 'pos' : ''}">${r.variance > 0 ? '+' : ''}${r.variance}</td>
          <td class="num" style="font-weight:650">${fmt0(r.booked)}</td>
          <td>${(r.locs || []).map((l) => `<span class="tag">${esc(l)}</span>`).join(' ')}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr style="font-weight:650"><td colspan="2">TOTAL</td><td class="num">${fmt0(sh.expectedTotal)}</td><td class="num">${fmt0(sh.actualTotal)}</td>
          <td class="num ${sh.actualTotal - sh.expectedTotal ? 'neg' : ''}">${sh.actualTotal - sh.expectedTotal}</td>
          <td class="num">${fmt0(sh.expectedTotal)}</td><td></td></tr></tfoot></table></div>
        <div class="hd" style="border-top:1px solid var(--line);border-bottom:none">
          ${booked ? `<span class="muted" style="font-size:12px">Booked by ${esc(sh.booked_by)} · ${esc(String(sh.booked_at || '').slice(0, 16).replace('T', ' '))}</span>`
            : `<span class="muted" style="font-size:12px">${sh.hasVariance ? '⚠ Variance vs CIPL. Booking ' + fmt0(sh.expectedTotal) + ' pcs (CIPL). ' : ''}Review then confirm.</span>
               <span class="spacer" style="flex:1"></span>
               <button class="btn green sm" onclick="WMS.bookInbound('${sh.id}')">✓ Book stock (${fmt0(sh.expectedTotal)} pcs)</button>`}
        </div></div>`;
    }).join('')}`;
  },
  async bookInbound(id) {
    try { const r = await API.req('/inbound/' + id + '/book', { method: 'POST' });
      this.toast(`✓ ${id}: ${fmt0(r.booked)} pcs added to stock${r.variance ? '. GRN variance flagged for ULD.' : ''}`, r.variance ? 'warn' : '');
      await this.reload();
    } catch (e) { this.toast(e.message, 'err'); }
  },

  /* ---------- OUTBOUND ---------- */
  view_outbound() {
    return `<div class="note" style="margin-bottom:16px">
      <b>Outbound:</b> PickedQty leaves the warehouse and is <b>auto-deducted</b> with an audit entry. Generate an <b>export Packing List</b> (Koehler xlsx format) from the picked goods.</div>
    ${S.issues.map((i) => {
      const tot = i.lines.reduce((a, l) => a + Number(l.qty), 0);
      return `<div class="card" style="margin-bottom:16px">
        <div class="hd"><h3>${esc(i.id)}</h3><span class="pill green">${esc(i.status)}</span>
          <span class="spacer" style="flex:1"></span>
          <span class="muted" style="font-size:12px">${esc(i.issue_date)} · ${esc((S.accMap[i.account] || {}).name)} · <span class="tag">${esc(i.ship_ref)}</span> · by ${esc(i.deducted_by)}</span>
          <button class="btn ghost sm" style="margin-left:10px" onclick="WMS.exportPackingList('${i.id}')">⎙ Export packing list</button></div>
        <div class="bd" style="padding:0"><table><thead><tr><th>SKU</th><th>Description</th><th class="num">PickedQty</th><th>UOM</th><th>Export permit</th><th>ULD lot</th></tr></thead>
        <tbody>${i.lines.map((l) => `<tr><td><span class="tag">${esc(l.sku)}</span></td><td>${esc(l.descr)}</td>
          <td class="num" style="font-weight:650">${fmt0(l.qty)}</td><td>${esc(l.uom)}</td>
          <td><span class="tag">${esc(l.permit)}</span></td><td><span class="tag">${esc(l.uld)}</span></td></tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight:650"><td colspan="2">TOTAL DEDUCTED</td><td class="num">${fmt0(tot)}</td><td colspan="3"></td></tr></tfoot></table></div></div>`;
    }).join('')}`;
  },
  exportPackingList(id) { this.download('/outbound/' + id + '/packing-list.xlsx', `PackingList-${id}.xlsx`); },

  /* ---------- STOCK ---------- */
  view_stock() {
    return `<div class="note" style="margin-bottom:14px">Perpetual balance: <b>Opening + Stock In − Stock Out = Closing</b>. Stock In = booked CIPL quantities. CBM/KGS auto-derived.</div>
    <div class="toolbar">
      <input id="stkSearch" placeholder="Search SKU / description…" oninput="WMS._fillStock()" style="min-width:240px">
      <select id="stkOwner" onchange="WMS._fillStock()"><option value="">All accounts</option>
        ${S.accounts.map((a) => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('')}</select></div>
    <div class="card"><div class="bd" style="padding:0"><table><thead><tr>
      <th>SKU</th><th>Description</th><th>Account</th><th class="num">Opening</th><th class="num">In</th><th class="num">Out</th>
      <th class="num">Closing</th><th class="num">CBM</th><th class="num">KGS</th><th>By shipment</th></tr></thead>
      <tbody id="stkBody"></tbody><tfoot id="stkFoot"></tfoot></table></div></div>`;
  },
  _fillStock() {
    const q = (document.getElementById('stkSearch')?.value || '').toLowerCase();
    const ow = document.getElementById('stkOwner')?.value || '';
    let led = S.stock.filter((r) => !ow || r.account === ow).filter((r) => !q || r.sku.toLowerCase().includes(q) || (r.descr || '').toLowerCase().includes(q)).sort((a, b) => b.closing - a.closing);
    const body = document.getElementById('stkBody'); if (!body) return;
    body.innerHTML = led.map((r) => `<tr><td><span class="tag">${esc(r.sku)}</span></td><td>${esc(r.descr)}</td><td>${esc((S.accMap[r.account] || {}).name)}</td>
      <td class="num">${fmt0(r.opening)}</td><td class="num">${fmt0(r.stockIn)}</td><td class="num">${fmt0(r.stockOut)}</td>
      <td class="num ${r.closing < 0 ? 'neg' : ''}" style="font-weight:650">${fmt0(r.closing)}</td>
      <td class="num">${fmt(r.cbm)}</td><td class="num">${fmt(r.kgs)}</td>
      <td>${Object.entries(r.byShip || {}).map(([s, q2]) => `<span class="tag">${esc(s)}: ${fmt0(q2)}</span>`).join(' ') || '<span class="muted">—</span>'}</td></tr>`).join('');
    document.getElementById('stkFoot').innerHTML = `<tr style="font-weight:650"><td colspan="3">TOTAL (${led.length})</td>
      <td class="num">${fmt0(led.reduce((a, r) => a + Number(r.opening), 0))}</td><td class="num">${fmt0(led.reduce((a, r) => a + Number(r.stockIn), 0))}</td>
      <td class="num">${fmt0(led.reduce((a, r) => a + Number(r.stockOut), 0))}</td><td class="num">${fmt0(led.reduce((a, r) => a + Number(r.closing), 0))}</td>
      <td class="num">${fmt(led.reduce((a, r) => a + Number(r.cbm), 0))}</td><td class="num">${fmt(led.reduce((a, r) => a + Number(r.kgs), 0))}</td><td></td></tr>`;
  },

  /* ---------- LOCATIONS ---------- */
  occupancy() {
    const occ = {};
    S.inbound.filter((s) => s.status === 'Booked').forEach((s) => (s.grnLines || []).forEach((l) => {
      if (!l.loc) return; if (!occ[l.loc]) occ[l.loc] = { sku: l.sku, qty: 0 }; occ[l.loc].qty += Number(l.actual_pcs);
    }));
    return occ;
  },
  view_locations() {
    const occ = this.occupancy();
    const aisles = ['AM-015', 'AM-016', 'AM-017', 'AM-018', 'AM-019', 'AM-020', 'AM-021', 'AM-022'];
    let html = `<div class="note" style="margin-bottom:14px">Bin map. Codes follow <span class="tag">AISLE-BAY-LEVEL-POSITION</span>. Green = occupied (booked stock).</div>`;
    aisles.forEach((a) => {
      const bins = Object.keys(occ).filter((l) => l.startsWith(a));
      const all = new Set(bins); ['001-A', '001-C', '002-A', '002-C', '003-A', '003-C'].forEach((s) => all.add(a + '-' + s));
      html += `<div class="card" style="margin-bottom:14px"><div class="hd"><h3>Aisle ${a}</h3><span class="spacer" style="flex:1"></span><span class="muted" style="font-size:12px">${bins.length} occupied</span></div>
        <div class="bd"><div class="loc-grid">${[...all].sort().map((l) => { const o = occ[l];
          return `<div class="loc ${o ? 'occ' : ''}"><div class="nm">${esc(l.replace(a + '-', ''))}</div>${o ? `<div class="q">${fmt0(o.qty)}</div><div class="nm">${esc(o.sku)}</div>` : '<div class="muted" style="font-size:10px;margin-top:6px">empty</div>'}</div>`; }).join('')}</div></div></div>`;
    });
    return html;
  },

  /* ---------- SKU MASTER ---------- */
  view_skus() {
    return `<div class="note" style="margin-bottom:14px">Item master with carton conversion factors used to derive CBM &amp; KGS.</div>
    <div class="card"><div class="bd" style="padding:0"><table><thead><tr><th>SKU</th><th>Description</th><th>Account</th><th class="num">PCS/CTN</th><th class="num">CBM/CTN</th><th class="num">KGS/CTN</th></tr></thead>
    <tbody>${S.skus.map((s) => `<tr><td><span class="tag">${esc(s.sku)}</span></td><td>${esc(s.descr)}</td><td>${esc((S.accMap[s.account] || {}).name)}</td>
      <td class="num">${fmt(s.pcs_ctn)}</td><td class="num">${fmt(s.cbm_ctn)}</td><td class="num">${fmt(s.kgs_ctn)}</td></tr>`).join('')}</tbody></table></div></div>`;
  },

  /* ---------- AUDIT ---------- */
  view_audit() {
    return `<div class="note" style="margin-bottom:14px">Immutable log of every stock-affecting action.</div>
    <div class="card"><div class="bd" style="padding:0"><table><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${S.audit.map((a) => `<tr><td><span class="muted">${esc(String(a.ts).slice(0, 19).replace('T', ' '))}</span></td><td>${esc(a.user_name)}</td>
      <td><span class="pill ${String(a.action).includes('DEDUCT') ? 'blue' : String(a.action).includes('BOOK') ? 'green' : 'amber'}">${esc(a.action)}</span></td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div></div>`;
  },

  /* ---------- USERS (admin) ---------- */
  view_users() {
    return `<div class="note" style="margin-bottom:14px">Per-user accounts. Role controls access; the audit trail records each person by name.</div>
      <div class="card"><div class="bd" id="usersBody">Loading…</div></div>`;
  },
  async _loadUsers() {
    try {
      const users = await API.req('/users');
      const el = document.getElementById('usersBody'); if (!el) return;
      el.style.padding = '0';
      el.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="pill ${u.role === 'ADMIN' ? 'blue' : ''}">${u.role}</span></td>
        <td style="text-align:right">${u.id !== this.user.id ? `<button class="btn ghost sm" onclick="WMS.delUser(${u.id})">Remove</button>` : '<span class="muted">you</span>'}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { const el = document.getElementById('usersBody'); if (el) el.textContent = e.message; }
  },
  newUser() {
    this.modal('New user', `
      <div class="grid2">
        <div class="field"><label>Name</label><input id="uName"></div>
        <div class="field"><label>Email</label><input id="uEmail" type="email"></div>
        <div class="field"><label>Role</label><select id="uRole"><option value="OPS">Warehouse / Ops</option><option value="ADMIN">Administrator</option></select></div>
        <div class="field"><label>Password</label><input id="uPass" type="password"></div>
      </div>`, 'Create user', 'WMS._doNewUser()');
  },
  async _doNewUser() {
    try {
      await API.req('/users', { method: 'POST', body: {
        name: document.getElementById('uName').value, email: document.getElementById('uEmail').value,
        role: document.getElementById('uRole').value, password: document.getElementById('uPass').value } });
      this.closeModal(); this.toast('User created.', 'info'); this._loadUsers();
    } catch (e) { this.toast(e.message, 'err'); }
  },
  async delUser(id) { try { await API.req('/users/' + id, { method: 'DELETE' }); this._loadUsers(); } catch (e) { this.toast(e.message, 'err'); } },

  /* ---------- ABOUT ---------- */
  view_about() {
    return `<div class="card"><div class="hd"><h3>How this WMS works</h3></div><div class="bd">
      <div class="flow">
        <span class="step">📦 Customer ships in</span><span class="arr">→</span>
        <span class="step">⬇ CIPL (expected) + GRN (confirm+bin)</span><span class="arr">→</span>
        <span class="step">⚖ Reconcile · book on CIPL</span><span class="arr">→</span>
        <span class="step">▤ Stock +</span><span class="arr">→</span>
        <span class="step">⬆ Pick · auto-deduct</span><span class="arr">→</span>
        <span class="step">⎙ Export Packing List (Koehler xlsx)</span><span class="arr">→</span>
        <span class="step">$ DRACO export</span></div>
      <p class="muted" style="font-size:12.5px">Backend: Node/Express + Postgres. Auth: per-user accounts (Admin / Ops) with JWT. Exports are real .xlsx files. Document intake: manual entry + Excel/CSV import (PDF auto-parsing is a later phase).</p>
    </div></div>`;
  },

  /* ---------- NEW INBOUND (manual + import) ---------- */
  newInbound() {
    this._inLines = [];
    this.modal('New inbound — CIPL + GRN', `
      <div class="grid3">
        <div class="field"><label>Account</label><select id="inAcc">${S.accounts.map((a) => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label>CIPL no.</label><input id="inCipl" placeholder="A11xxx"></div>
        <div class="field"><label>PO #</label><input id="inPo" placeholder="36056"></div>
        <div class="field"><label>Vessel</label><input id="inVessel"></div>
        <div class="field"><label>ETA</label><input id="inEta" placeholder="2026-06-06 Singapore"></div>
        <div class="field"><label>Permit</label><input id="inPermit"></div>
      </div>
      <label>Import CIPL or GRN spreadsheet (.xlsx / .csv) to auto-fill lines</label>
      <div class="drop" id="inDrop" onclick="document.getElementById('inFile').click()">⬆ Click to upload an Excel/CSV with SKU + quantity columns</div>
      <input type="file" id="inFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="WMS._importLines(event)">
      <div id="inLinesPreview" style="margin-top:12px"></div>
      <div class="note" style="margin-top:12px">Booked stock uses the CIPL (expected) quantity. You can also add lines after creating the shipment.</div>`,
      'Create inbound (pending)', 'WMS._doNewInbound()');
  },
  async _importLines(ev) {
    const file = ev.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await API.req('/inbound/import', { method: 'POST', body: fd });
      this._inLines = r.records;
      document.getElementById('inDrop').classList.add('done');
      document.getElementById('inDrop').textContent = `✓ ${file.name} — ${r.count} lines parsed`;
      document.getElementById('inLinesPreview').innerHTML = `<table><thead><tr><th>SKU</th><th class="num">Expected (CIPL)</th><th class="num">Actual (GRN)</th><th>Bin</th></tr></thead>
        <tbody>${this._inLines.map((l) => `<tr><td>${esc(l.sku)}</td><td class="num">${fmt0(l.pcs || 0)}</td><td class="num">${fmt0(l.actual || l.pcs || 0)}</td><td>${esc(l.loc || '')}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { this.toast(e.message, 'err'); }
  },
  async _doNewInbound() {
    const lines = this._inLines || [];
    const body = {
      account: document.getElementById('inAcc').value,
      cipl_no: document.getElementById('inCipl').value, po: document.getElementById('inPo').value,
      vessel: document.getElementById('inVessel').value, eta: document.getElementById('inEta').value,
      permit: document.getElementById('inPermit').value, received_date: new Date().toISOString().slice(0, 10),
      ciplLines: lines.map((l) => ({ sku: l.sku, expected_pcs: l.pcs || 0, ctn: l.ctn || null })),
      grnLines: lines.filter((l) => l.loc || l.actual != null).map((l) => ({ sku: l.sku, loc: l.loc || null, actual_pcs: l.actual != null ? l.actual : (l.pcs || 0) })),
    };
    try { const r = await API.req('/inbound', { method: 'POST', body }); this.closeModal(); this.toast(`Inbound ${r.id} created (pending review).`, 'info'); await this.reload(); }
    catch (e) { this.toast(e.message, 'err'); }
  },

  /* ---------- NEW PICK ---------- */
  newIssue() {
    this.modal('New pick — Goods Issue', `
      <div class="grid2">
        <div class="field"><label>Account</label><select id="iAcc" onchange="WMS._syncShip()">${S.accounts.map((a) => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Shipment ref</label><input id="iShip" placeholder="T251"></div>
        <div class="field"><label>Export permit</label><input id="iPermit"></div>
        <div class="field"><label>ULD lot</label><input id="iUld"></div>
      </div>
      <div class="field"><label>SKU</label><select id="iSku">${S.skus.map((s) => `<option value="${esc(s.sku)}">${esc(s.sku)} — ${esc(s.descr)}</option>`).join('')}</select></div>
      <div class="field"><label>PickedQty (PCS) — auto-deducted on confirm</label><input id="iQty" type="number" placeholder="0"></div>
      <div class="note">On confirm the PickedQty is deducted from stock and recorded in the audit trail with your name &amp; time.</div>`,
      'Pick & deduct', 'WMS._doIssue()');
    this._syncShip();
  },
  _syncShip() { const acc = document.getElementById('iAcc'); const ship = document.getElementById('iShip'); if (acc && ship && !ship.value) ship.value = (S.accMap[acc.value] || {}).ship_ref || ''; },
  async _doIssue() {
    const sku = document.getElementById('iSku').value;
    const qty = parseInt(document.getElementById('iQty').value || '0', 10);
    const acc = document.getElementById('iAcc').value;
    if (!qty) return this.toast('Enter a PickedQty.', 'warn');
    const before = (S.stock.find((r) => r.sku === sku) || {}).closing || 0;
    try {
      const r = await API.req('/outbound', { method: 'POST', body: {
        account: acc, ship_ref: document.getElementById('iShip').value || (S.accMap[acc] || {}).ship_ref,
        lines: [{ sku, qty, permit: document.getElementById('iPermit').value, uld: document.getElementById('iUld').value }] } });
      this.closeModal(); await this.reload();
      const after = before - qty;
      this.toast(`✓ ${fmt0(qty)} pcs of ${sku} deducted. Balance now ${fmt0(after)} pcs.${after < 0 ? ' ⚠ negative!' : ''}`, after < 0 ? 'warn' : '');
    } catch (e) { this.toast(e.message, 'err'); }
  },

  /* ---------- exports ---------- */
  exportDraco() { this.download('/stock/draco.xlsx', 'DRACO-STOCK-export.xlsx'); },
  async download(path, filename) {
    try { const blob = await API.blob(path); const u = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); URL.revokeObjectURL(u);
      this.toast('Download started: ' + filename, 'info');
    } catch (e) { this.toast(e.message, 'err'); }
  },

  /* ---------- search ---------- */
  async search() {
    const q = (document.getElementById('globalSearch')?.value || '').trim();
    const box = document.getElementById('sresults'); if (!box) return;
    if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }
    let res = [];
    try { res = await API.req('/search?q=' + encodeURIComponent(q)); } catch (e) { return; }
    if (!res.length) { box.innerHTML = `<div class="sempty">No matches for "${esc(q)}". Try a GI no, T251, GR, CIPL no, or SKU.</div>`; box.classList.add('open'); return; }
    const cats = {}; res.forEach((r) => (cats[r.cat] = cats[r.cat] || []).push(r));
    box.innerHTML = Object.entries(cats).map(([c, items]) => `<div class="scat">${esc(c)} (${items.length})</div>${items.map((r) =>
      `<div class="sitem" onclick="WMS.pickSearch('${r.page}','${esc(r.q || '')}')"><span class="stype">${esc(r.type)}</span><span>${esc(r.label)}</span><span class="smeta">${esc(r.meta)}</span></div>`).join('')}`).join('');
    box.classList.add('open');
  },
  pickSearch(page, q) { this.closeSearch(); this.go(page); if (page === 'stock' && q) { const el = document.getElementById('stkSearch'); if (el) { el.value = q; this._fillStock(); } } },
  closeSearch() { const b = document.getElementById('sresults'); if (b) b.classList.remove('open'); const i = document.getElementById('globalSearch'); if (i) i.value = ''; },

  /* ---------- modal + toast ---------- */
  modal(title, body, cta, onClick) {
    document.getElementById('modalRoot').innerHTML = `
    <div class="overlay" onclick="if(event.target===this)WMS.closeModal()"><div class="modal">
      <div class="hd"><h3>${esc(title)}</h3><span class="x" onclick="WMS.closeModal()">×</span></div>
      <div class="bd">${body}</div>
      <div class="ft"><button class="btn ghost" onclick="WMS.closeModal()">Cancel</button>
        <button class="btn" onclick="${onClick || 'WMS.closeModal()'}">${esc(cta)}</button></div></div></div>`;
  },
  closeModal() { document.getElementById('modalRoot').innerHTML = ''; },
  toast(msg, kind) { const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    document.getElementById('toasts').appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4500); },
};
function kpi(lbl, val, delta) { return `<div class="card kpi"><div class="lbl">${esc(lbl)}</div><div class="val">${val}</div><div class="delta">${esc(delta || '')}</div></div>`; }

// Users page needs an async post-render hook
const _origRender = WMS.render.bind(WMS);
WMS.render = function () { _origRender(); if (this.page === 'users') this._loadUsers(); };

WMS.boot();
