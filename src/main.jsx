import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Trash2, Save, RefreshCcw, LogOut, Calculator, Settings, FolderOpen } from 'lucide-react';
import { supabase } from './lib/supabase';
import { calculateProduct, calculateScenarios } from './lib/calc';
import './styles.css';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'HKD', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'SGD'];
const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', HKD: 'HK$', CAD: 'C$', AUD: 'A$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr', MXN: '$', SGD: 'S$' };

function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const [winningProducts, setWinningProducts] = useState([]);
  const [killProfiles, setKillProfiles] = useState([]);
  const [scenarios, setScenarios] = useState([]);

  const [activeProductIds, setActiveProductIds] = useState([]);
  const [selectedKillProfileId, setSelectedKillProfileId] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [scenarioName, setScenarioName] = useState('Default Scenario');

  const [productResults, setProductResults] = useState([]);
  const [calcBusy, setCalcBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('calculator');

  const currSymbol = CURRENCY_SYMBOLS[displayCurrency] || '$';
  function money(v) {
    const n = Number(v || 0);
    return (n < 0 ? '-' : '') + currSymbol + Math.abs(n).toFixed(2);
  }
  function num(v) { return Number(v || 0).toFixed(2); }

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function handleAuth(e) {
    e.preventDefault();
    setBusy(true); setMessage('');
    try {
      const fn = authMode === 'signUp' ? supabase.auth.signUp : supabase.auth.signInWithPassword;
      const { error } = await fn.call(supabase.auth, { email, password });
      if (error) throw error;
      setMessage(authMode === 'signUp' ? 'Check your email to confirm your account.' : 'Signed in.');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  async function loadData() {
    setBusy(true);
    try {
      const [wp, kp, sc] = await Promise.all([
        supabase.from('winning_products').select('*').order('created_at'),
        supabase.from('kill_profiles').select('*').order('created_at'),
        supabase.from('scenarios').select('*').order('created_at', { ascending: false }),
      ]);
      for (const r of [wp, kp, sc]) if (r.error) throw r.error;
      setWinningProducts(wp.data);
      setKillProfiles(kp.data);
      setScenarios(sc.data);
      setActiveProductIds(wp.data.map(p => p.id));
      setSelectedKillProfileId(kp.data[0]?.id || '');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  // Recalculate whenever active products or display currency changes
  const calcKey = useMemo(
    () => activeProductIds.join(',') + '|' + displayCurrency + '|' + winningProducts.map(p => JSON.stringify(p)).join(','),
    [activeProductIds, displayCurrency, winningProducts]
  );

  useEffect(() => {
    const activeProducts = winningProducts.filter(p => activeProductIds.includes(p.id));
    if (!activeProducts.length) { setProductResults([]); return; }
    let cancelled = false;
    setCalcBusy(true);
    Promise.all(activeProducts.map(p => calculateProduct(p, displayCurrency).then(r => ({ ...p, ...r }))))
      .then(results => { if (!cancelled) setProductResults(results); })
      .catch(err => { if (!cancelled) setMessage(err.message); })
      .finally(() => { if (!cancelled) setCalcBusy(false); });
    return () => { cancelled = true; };
  }, [calcKey]);

  const totalProfit = useMemo(
    () => productResults.reduce((sum, p) => sum + p.netProfit, 0),
    [productResults]
  );

  const selectedKillProfile = useMemo(
    () => killProfiles.find(p => p.id === selectedKillProfileId),
    [killProfiles, selectedKillProfileId]
  );

  const scenarioResults = useMemo(
    () => calculateScenarios(totalProfit, selectedKillProfile),
    [totalProfit, selectedKillProfile]
  );

  // Winning product CRUD
  async function addWinningProduct() {
    const item = { name: 'New Product', currency: 'USD', daily_ad_spend: 100, roas: 1.5, variable_cost_pct: 18.5, opex_share: 0 };
    const { data, error } = await supabase.from('winning_products').insert(item).select().single();
    if (error) return setMessage(error.message);
    setWinningProducts(prev => [...prev, data]);
    setActiveProductIds(prev => [...prev, data.id]);
  }

  async function updateWP(id, patch) {
    setWinningProducts(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from('winning_products').update(patch).eq('id', id);
    if (error) setMessage(error.message);
  }

  async function removeWP(id) {
    setWinningProducts(prev => prev.filter(x => x.id !== id));
    setActiveProductIds(prev => prev.filter(pid => pid !== id));
    const { error } = await supabase.from('winning_products').delete().eq('id', id);
    if (error) setMessage(error.message);
  }

  // Kill profile CRUD
  async function addKillProfile() {
    const item = { name: 'New Kill Profile', test_budget_per_day: 100, kill1_no_atc: 30, kill2_no_purchase: 50, kill3_day2_no_sales: 50 };
    const { data, error } = await supabase.from('kill_profiles').insert(item).select().single();
    if (error) return setMessage(error.message);
    setKillProfiles(prev => [...prev, data]);
    if (!selectedKillProfileId) setSelectedKillProfileId(data.id);
  }

  async function updateKP(id, patch) {
    setKillProfiles(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from('kill_profiles').update(patch).eq('id', id);
    if (error) setMessage(error.message);
  }

  async function removeKP(id) {
    setKillProfiles(prev => prev.filter(x => x.id !== id));
    if (selectedKillProfileId === id) setSelectedKillProfileId(killProfiles.filter(x => x.id !== id)[0]?.id || '');
    const { error } = await supabase.from('kill_profiles').delete().eq('id', id);
    if (error) setMessage(error.message);
  }

  function toggleProduct(id) {
    setActiveProductIds(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  }

  async function saveScenario() {
    const item = { name: scenarioName, active_product_ids: activeProductIds, selected_kill_profile_id: selectedKillProfileId, display_currency: displayCurrency };
    const { data, error } = await supabase.from('scenarios').insert(item).select().single();
    if (error) return setMessage(error.message);
    setScenarios(prev => [data, ...prev]);
    setMessage('Scenario saved.');
  }

  function loadScenario(s) {
    setScenarioName(s.name);
    setActiveProductIds(s.active_product_ids || []);
    setSelectedKillProfileId(s.selected_kill_profile_id || '');
    setDisplayCurrency(s.display_currency || 'USD');
  }

  // Auth screen
  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">TC</div>
          <h1>Test Capacity Calculator</h1>
          <p>Sign in to manage your winning products, kill rule profiles, and saved scenarios.</p>
          <form onSubmit={handleAuth} className="stack auth-form">
            <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
            <button disabled={busy}>{authMode === 'signUp' ? 'Create account' : 'Sign in'}</button>
          </form>
          <button className="link" onClick={() => setAuthMode(authMode === 'signUp' ? 'signIn' : 'signUp')}>
            {authMode === 'signUp' ? 'Already have an account? Sign in' : 'Need an account? Create one'}
          </button>
          {message && <p className="message">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">Testing workspace</div>
          <h1>Test Capacity Calculator</h1>
          <p>Know exactly how many products you can test simultaneously without putting your winners at risk. Add your winning products, set your kill rules, and see your safe test ceiling.</p>
        </div>
        <div className="top-actions">
          <button className={activeTab === 'calculator' ? '' : 'secondary'} onClick={() => setActiveTab('calculator')}>
            <Calculator size={16} /> Calculator
          </button>
          <button className={activeTab === 'settings' ? '' : 'secondary'} onClick={() => setActiveTab('settings')}>
            <Settings size={16} /> Settings
          </button>
          <button className="secondary" onClick={loadData}><RefreshCcw size={16} /> Refresh</button>
          <button className="secondary" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      {/* SETTINGS TAB */}
      {activeTab === 'settings' && (
        <section className="settings-center panel wide">
          <div className="section-head wrap">
            <PanelTitle title="Settings" subtitle="Manage winning products and kill rule profiles. Changes save automatically to Supabase." />
            <button className="secondary small" onClick={() => setActiveTab('calculator')}>Back to calculator</button>
          </div>

          <div className="settings-grid">
            <div className="settings-card">
              <div className="section-head">
                <PanelTitle title="Winning products" subtitle="Your active campaigns generating daily profit. Each product's net profit contributes to your test budget." />
                <button onClick={addWinningProduct}><Plus size={16} /> Add product</button>
              </div>
              <div className="field-header wp-entity">
                <span>Name</span><span>Currency</span><span>Ad spend/day</span><span>ROAS</span><span>Var cost %</span><span>OPEX share/day</span><span></span>
              </div>
              <div className="entity-list">
                {winningProducts.map(p => (
                  <div className="entity wp-entity" key={p.id}>
                    <input value={p.name} onChange={e => updateWP(p.id, { name: e.target.value })} />
                    <select value={p.currency || 'USD'} onChange={e => updateWP(p.id, { currency: e.target.value })}>
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input type="number" step="1" value={p.daily_ad_spend} onChange={e => updateWP(p.id, { daily_ad_spend: Number(e.target.value) })} />
                    <input type="number" step="0.01" value={p.roas} onChange={e => updateWP(p.id, { roas: Number(e.target.value) })} />
                    <input type="number" step="0.1" value={p.variable_cost_pct} onChange={e => updateWP(p.id, { variable_cost_pct: Number(e.target.value) })} />
                    <input type="number" step="0.01" value={p.opex_share} onChange={e => updateWP(p.id, { opex_share: Number(e.target.value) })} />
                    <button className="icon" onClick={() => removeWP(p.id)} title="Delete"><Trash2 size={16} /></button>
                  </div>
                ))}
                {!winningProducts.length && <p className="empty-text">No winning products yet. Click Add product to get started.</p>}
              </div>
            </div>

            <div className="settings-card">
              <div className="section-head">
                <PanelTitle title="Kill rule profiles" subtitle="Save different kill rule configs. Switch between them in the calculator without changing your product settings." />
                <button onClick={addKillProfile}><Plus size={16} /> Add profile</button>
              </div>
              <div className="field-header kp-entity">
                <span>Name</span><span>Budget/day</span><span>Kill: no ATC</span><span>Kill: no purchase</span><span>Kill: Day 2</span><span></span>
              </div>
              <div className="entity-list">
                {killProfiles.map(p => (
                  <div className="entity kp-entity" key={p.id}>
                    <input value={p.name} onChange={e => updateKP(p.id, { name: e.target.value })} />
                    <input type="number" step="1" value={p.test_budget_per_day} onChange={e => updateKP(p.id, { test_budget_per_day: Number(e.target.value) })} />
                    <input type="number" step="1" value={p.kill1_no_atc} onChange={e => updateKP(p.id, { kill1_no_atc: Number(e.target.value) })} />
                    <input type="number" step="1" value={p.kill2_no_purchase} onChange={e => updateKP(p.id, { kill2_no_purchase: Number(e.target.value) })} />
                    <input type="number" step="1" value={p.kill3_day2_no_sales} onChange={e => updateKP(p.id, { kill3_day2_no_sales: Number(e.target.value) })} />
                    <button className="icon" onClick={() => removeKP(p.id)} title="Delete"><Trash2 size={16} /></button>
                  </div>
                ))}
                {!killProfiles.length && <p className="empty-text">No kill profiles yet. Click Add profile to create one.</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CALCULATOR TAB */}
      {activeTab === 'calculator' && (
        <>
          <section className="workspace-bar panel">
            <div>
              <div className="eyebrow">Current scenario</div>
              <h2>{scenarioName}</h2>
              <p>
                {productResults.length} winning product{productResults.length !== 1 ? 's' : ''} active
                {selectedKillProfile ? ` · ${selectedKillProfile.name}` : ' · No kill profile selected'}
                {' '}· Results in {displayCurrency}
                {calcBusy && ' · Fetching FX rates…'}
              </p>
            </div>
            <div className="workspace-actions">
              <button onClick={() => setActiveTab('settings')}><Settings size={16} /> Settings</button>
              <button className="secondary" onClick={saveScenario}><Save size={16} /> Save scenario</button>
            </div>
          </section>

          <section className="grid setup-grid" style={{ marginBottom: 16 }}>
            <div className="panel scenario-panel">
              <PanelTitle title="Scenario setup" subtitle="Select which winning products and kill rule profile to use for this calculation." />
              <div className="form-grid three-cols" style={{ marginTop: 14 }}>
                <Field label="Scenario name">
                  <input value={scenarioName} onChange={e => setScenarioName(e.target.value)} />
                </Field>
                <Field label="Kill rule profile">
                  <select value={selectedKillProfileId} onChange={e => setSelectedKillProfileId(e.target.value)}>
                    {!killProfiles.length && <option value="">No profiles — add in Settings</option>}
                    {killProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Display currency">
                  <select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              {selectedKillProfile && (
                <div style={{ marginTop: 14, padding: '12px 14px', background: '#f8fafc', borderRadius: 14, border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>
                    Kill thresholds — {selectedKillProfile.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <KillStat label="Day 1 no ATC" value={`$${selectedKillProfile.kill1_no_atc}`} />
                    <KillStat label="Day 1 no purchase" value={`$${selectedKillProfile.kill2_no_purchase}`} />
                    <KillStat label="Day 2 no sales" value={`+$${selectedKillProfile.kill3_day2_no_sales}`} />
                  </div>
                </div>
              )}

              <div className="saved-scenarios">
                <div className="mini-title"><FolderOpen size={14} /> Saved scenarios</div>
                {scenarios.length
                  ? <div className="chips">{scenarios.map(s => <button key={s.id} className="chip" onClick={() => loadScenario(s)}>{s.name}</button>)}</div>
                  : <p className="empty-text">No saved scenarios yet. Configure and click Save scenario.</p>
                }
              </div>
            </div>

            <div className="panel">
              <PanelTitle title="Winning products" subtitle="Toggle which products contribute to your daily testing budget. All active products are summed." />
              <div className="product-toggle-list" style={{ marginTop: 14 }}>
                {winningProducts.map(p => {
                  const isActive = activeProductIds.includes(p.id);
                  const result = productResults.find(r => r.id === p.id);
                  return (
                    <div key={p.id} className={`product-toggle ${isActive ? 'active' : 'inactive'}`}>
                      <div className="product-toggle-left">
                        <label className="switch">
                          <input type="checkbox" checked={isActive} onChange={() => toggleProduct(p.id)} />
                          <span />
                        </label>
                        <div>
                          <strong>{p.name}</strong>
                          <span className="product-meta">
                            {p.currency} {p.daily_ad_spend}/day · ROAS {Number(p.roas).toFixed(2)} · {p.variable_cost_pct}% var cost
                          </span>
                        </div>
                      </div>
                      <div className={`product-profit ${!isActive ? 'inactive-profit' : result ? (result.netProfit >= 0 ? 'positive' : 'negative') : ''}`}>
                        {!isActive ? 'Inactive' : result ? <>{money(result.netProfit)}<span>/day</span></> : '…'}
                      </div>
                    </div>
                  );
                })}
                {!winningProducts.length && <p className="empty-text">No winning products added yet. Go to Settings to add them.</p>}
              </div>
            </div>
          </section>

          <div className="metrics-row">
            <div className={`metric-card ${totalProfit >= 0 ? 'profit' : 'loss'}`}>
              <div className="metric-val">{calcBusy ? '…' : money(totalProfit)}</div>
              <div className="metric-lbl">Total daily profit (test budget)</div>
            </div>
            <div className="metric-card">
              <div className="metric-val">{calcBusy ? '…' : money(productResults.reduce((s, p) => s + p.netSales, 0))}</div>
              <div className="metric-lbl">Total daily net sales</div>
            </div>
            <div className="metric-card">
              <div className="metric-val">{productResults.length}</div>
              <div className="metric-lbl">Winning products active</div>
            </div>
            <div className="metric-card">
              <div className="metric-val">{selectedKillProfile ? `$${selectedKillProfile.test_budget_per_day}` : '—'}</div>
              <div className="metric-lbl">Test budget per product/day</div>
            </div>
          </div>

          {productResults.length > 1 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle title="Per-product breakdown" subtitle="Individual contribution of each active winning product to the shared testing budget." />
              <div className="table-card" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th><th>Currency</th><th>Ad spend/day</th><th>ROAS</th>
                      <th>Net sales/day</th><th>Var costs</th><th>OPEX share</th><th>Net profit/day</th><th>BER</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productResults.map(p => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.currency}{displayCurrency !== p.currency ? ` → ${displayCurrency}` : ''}</td>
                        <td>{money(p.adSpend)}</td>
                        <td>{num(p.roas)}</td>
                        <td>{money(p.netSales)}</td>
                        <td>{money(p.varCosts)}</td>
                        <td>{money(p.opex)}</td>
                        <td style={{ color: p.netProfit >= 0 ? '#047857' : '#b91c1c', fontWeight: 900 }}>{money(p.netProfit)}</td>
                        <td>{num(p.ber)}</td>
                      </tr>
                    ))}
                    <tr className="strong-row">
                      <td colSpan={2}>Total ({displayCurrency})</td>
                      <td>{money(productResults.reduce((s, p) => s + p.adSpend, 0))}</td>
                      <td>—</td>
                      <td>{money(productResults.reduce((s, p) => s + p.netSales, 0))}</td>
                      <td>{money(productResults.reduce((s, p) => s + p.varCosts, 0))}</td>
                      <td>{money(productResults.reduce((s, p) => s + p.opex, 0))}</td>
                      <td style={{ color: totalProfit >= 0 ? '#047857' : '#b91c1c', fontWeight: 900 }}>{money(totalProfit)}</td>
                      <td>—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {scenarioResults.length > 0 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle title="Store net profit — simultaneous tests" subtitle="How much the store nets daily at each test count, across your three kill rule scenarios." />
              <div className="table-card" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Tests running</th>
                      {scenarioResults.map(s => (
                        <th key={s.label}>{s.label}<span className="th-note">{s.note}</span></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4, 5].map(n => (
                      <tr key={n} className={n === 0 ? 'strong-row' : ''}>
                        <td>{n === 0 ? '0 — no testing' : `${n} test${n > 1 ? 's' : ''}`}</td>
                        {scenarioResults.map(s => {
                          const net = s.storeNets[n];
                          const cls = net >= 0 ? 'good' : net >= -25 ? 'warn' : 'bad';
                          return (
                            <td key={s.label}>
                              <span className={`net-val${net < 0 ? ' negative' : ''}`}>{money(net)}</span>
                              <span className={`status-pill ${cls}`}>{net >= 0 ? 'Positive' : net >= -25 ? 'Marginal' : 'Negative'}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {scenarioResults.length > 0 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle title="Safe test ceiling" subtitle="Maximum simultaneous tests before going store-negative, by scenario." />
              <div className="recommendation-grid" style={{ marginTop: 14 }}>
                {scenarioResults.map(s => {
                  const max = Math.max(0, s.maxTests);
                  const cls = max >= 3 ? 'good' : max >= 1 ? 'ok' : 'bad';
                  const label = { good: 'Plenty of room', ok: 'Limited runway', bad: 'No headroom' }[cls];
                  return (
                    <div key={s.label} className={`recommendation-card ${cls}`}>
                      <div className="recommendation-top">
                        <strong>{max} test{max !== 1 ? 's' : ''}</strong>
                        <span>{s.label}</span>
                      </div>
                      <p>{label}. {s.description}</p>
                      <small>Daily budget: {money(totalProfit)} · Burn at {max} test{max !== 1 ? 's' : ''}: {money(max * s.burn)}</small>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {!selectedKillProfile && winningProducts.length > 0 && (
            <div className="notice">Select a kill rule profile to see scenario results. Add one in Settings if none exist.</div>
          )}
        </>
      )}
    </main>
  );
}

function PanelTitle({ title, subtitle }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function KillStat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', letterSpacing: '-.03em' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginTop: 2 }}>{label}</div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
