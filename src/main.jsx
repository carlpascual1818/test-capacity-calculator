import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Trash2, Save, RefreshCcw, LogOut, Calculator, Settings, FolderOpen, ArrowRight } from 'lucide-react';
import { supabase } from './lib/supabase';
import { calculateProduct, calculateScenarios } from './lib/calc';
import './styles.css';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'HKD', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'SGD'];
const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', HKD: 'HK$', CAD: 'C$', AUD: 'A$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr', MXN: '$', SGD: 'S$' };

const CONDITIONS = [
  { value: 'no_atc', label: 'No ATC' },
  { value: 'no_purchase', label: 'No purchase' },
  { value: 'no_sales', label: 'No sales' },
  { value: 'profitable', label: 'Profitable' },
  { value: 'roas_below', label: 'ROAS below threshold' },
];

const OUTCOMES = [
  { value: 'kill', label: 'Kill' },
  { value: 'continue', label: 'Continue' },
];

function newRule() {
  return { id: crypto.randomUUID(), name: '', spend_threshold: 50, condition: 'no_purchase', outcome: 'kill' };
}

function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const [winningProducts, setWinningProducts] = useState([]);
  const [processors, setProcessors] = useState([]);
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
  const money = v => { const n = Number(v || 0); return (n < 0 ? '-' : '') + currSymbol + Math.abs(n).toFixed(2); };
  const num = v => Number(v || 0).toFixed(2);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadData(); }, [session]);

  async function handleAuth(e) {
    e.preventDefault(); setBusy(true); setMessage('');
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
      const [wp, pp, kp, sc] = await Promise.all([
        supabase.from('winning_products').select('*').order('created_at'),
        supabase.from('payment_processors').select('*').order('created_at'),
        supabase.from('kill_profiles').select('*').order('created_at'),
        supabase.from('scenarios').select('*').order('created_at', { ascending: false }),
      ]);
      for (const r of [wp, pp, kp, sc]) if (r.error) throw r.error;
      setWinningProducts(wp.data);
      setProcessors(pp.data);
      setKillProfiles(kp.data);
      setScenarios(sc.data);
      setActiveProductIds(wp.data.map(p => p.id));
      setSelectedKillProfileId(kp.data[0]?.id || '');
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }

  const calcKey = useMemo(
    () => activeProductIds.join(',') + '|' + displayCurrency + '|' +
      winningProducts.map(p => JSON.stringify(p)).join(',') + '|' +
      processors.map(p => JSON.stringify(p)).join(','),
    [activeProductIds, displayCurrency, winningProducts, processors]
  );

  useEffect(() => {
    const active = winningProducts.filter(p => activeProductIds.includes(p.id));
    if (!active.length) { setProductResults([]); return; }
    let cancelled = false;
    setCalcBusy(true);
    Promise.all(active.map(p => calculateProduct(p, processors, displayCurrency).then(r => ({ ...p, ...r }))))
      .then(results => { if (!cancelled) setProductResults(results); })
      .catch(err => { if (!cancelled) setMessage(err.message); })
      .finally(() => { if (!cancelled) setCalcBusy(false); });
    return () => { cancelled = true; };
  }, [calcKey]);

  const totalProfit = useMemo(() => productResults.reduce((s, p) => s + p.netProfit, 0), [productResults]);
  const selectedKillProfile = useMemo(() => killProfiles.find(p => p.id === selectedKillProfileId), [killProfiles, selectedKillProfileId]);
  const scenarioResults = useMemo(() => calculateScenarios(totalProfit, selectedKillProfile), [totalProfit, selectedKillProfile]);
  const testBudget = Number(selectedKillProfile?.test_budget_per_day || 0);
  const safeCapacity = testBudget > 0 ? Math.max(0, Math.floor(totalProfit / testBudget)) : 0;
  const conservativeCapacity = testBudget > 0 ? Math.max(0, Math.floor((totalProfit * 0.7) / testBudget)) : 0;
  const aggressiveCapacity = testBudget > 0 ? Math.max(0, Math.floor((totalProfit + testBudget) / testBudget)) : 0;
  const bufferAfterSafe = totalProfit - (safeCapacity * testBudget);
  const nextTestShortfall = testBudget > 0 ? Math.max(0, ((safeCapacity + 1) * testBudget) - totalProfit) : 0;
  const capacityStatus = safeCapacity >= 3 ? 'good' : safeCapacity >= 1 ? 'ok' : 'bad';

  // Winning Products CRUD
  async function addWinningProduct() {
    const item = { name: 'New Product', currency: 'USD', daily_ad_spend: 100, roas: 1.5, cogs_pct: 12, aov: 40, opex_share: 0 };
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

  // Processors CRUD
  async function addProcessor() {
    const item = { name: 'New Processor', percent_fee: 0, fixed_fee: 0, fixed_fee_currency: 'USD', conversion_fee_percent: 0, active: true };
    const { data, error } = await supabase.from('payment_processors').insert(item).select().single();
    if (error) return setMessage(error.message);
    setProcessors(prev => [...prev, data]);
  }
  async function updateProcessor(id, patch) {
    setProcessors(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from('payment_processors').update(patch).eq('id', id);
    if (error) setMessage(error.message);
  }
  async function removeProcessor(id) {
    setProcessors(prev => prev.filter(x => x.id !== id));
    const { error } = await supabase.from('payment_processors').delete().eq('id', id);
    if (error) setMessage(error.message);
  }

  // Kill Profiles CRUD
  async function addKillProfile() {
    const defaultRules = [
      { id: crypto.randomUUID(), name: 'No ATC by $30', spend_threshold: 30, condition: 'no_atc', outcome: 'kill' },
      { id: crypto.randomUUID(), name: 'No purchase by $50', spend_threshold: 50, condition: 'no_purchase', outcome: 'kill' },
      { id: crypto.randomUUID(), name: 'Profitable Day 1 — continue', spend_threshold: 100, condition: 'profitable', outcome: 'continue' },
    ];
    const item = { name: 'New Kill Profile', test_budget_per_day: 100, rules: defaultRules };
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

  // Rule management within a kill profile
  function addRule(profileId) {
    const profile = killProfiles.find(p => p.id === profileId);
    if (!profile) return;
    const rules = [...(profile.rules || []), newRule()];
    updateKP(profileId, { rules });
  }
  function updateRule(profileId, ruleId, patch) {
    const profile = killProfiles.find(p => p.id === profileId);
    if (!profile) return;
    const rules = (profile.rules || []).map(r => r.id === ruleId ? { ...r, ...patch } : r);
    updateKP(profileId, { rules });
  }
  function removeRule(profileId, ruleId) {
    const profile = killProfiles.find(p => p.id === profileId);
    if (!profile) return;
    const rules = (profile.rules || []).filter(r => r.id !== ruleId);
    updateKP(profileId, { rules });
  }

  function toggleProduct(id) {
    setActiveProductIds(prev => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
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

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark">TC</div>
          <h1>Test Capacity Calculator</h1>
          <p>Sign in to manage your winning products, processors, kill rule profiles, and saved scenarios.</p>
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
          <p>Know exactly how many products you can test simultaneously without putting your winners at risk. Configure your winning products, processors, and kill rules — then see your safe test ceiling.</p>
        </div>
        <div className="top-actions">
          <button className={activeTab === 'calculator' ? '' : 'secondary'} onClick={() => setActiveTab('calculator')}><Calculator size={16} /> Calculator</button>
          <button className={activeTab === 'settings' ? '' : 'secondary'} onClick={() => setActiveTab('settings')}><Settings size={16} /> Settings</button>
          <button className="secondary" onClick={loadData}><RefreshCcw size={16} /> Refresh</button>
          <button className="secondary" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      {/* SETTINGS */}
      {activeTab === 'settings' && (
        <section className="settings-center panel wide">
          <div className="section-head wrap">
            <PanelTitle title="Settings" subtitle="Manage winning products, payment processors, and kill rule profiles. Changes save automatically." />
            <button className="secondary small" onClick={() => setActiveTab('calculator')}>Back to calculator</button>
          </div>

          {/* Winning Products */}
          <div className="settings-card settings-full">
            <div className="section-head">
              <PanelTitle title="Winning products" subtitle="Active campaigns generating daily profit. COGS % and processor fees are calculated separately." />
              <button onClick={addWinningProduct}><Plus size={16} /> Add product</button>
            </div>
            <div className="field-header wp-entity">
              <span>Name</span><span>Currency</span><span>Avg spend/day ⓘ</span><span>3-day ROAS</span><span>COGS %</span><span>AOV</span><span>BEROAS</span><span>OPEX/day</span><span></span>
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
                  <input type="number" step="0.1" value={p.cogs_pct} onChange={e => updateWP(p.id, { cogs_pct: Number(e.target.value) })} />
                  <input type="number" step="0.01" value={p.aov} onChange={e => updateWP(p.id, { aov: Number(e.target.value) })} />
                  <input type="number" step="0.01" value={p.beroas ?? 1.28} onChange={e => updateWP(p.id, { beroas: Number(e.target.value) })} />
                  <input type="number" step="0.01" value={p.opex_share} onChange={e => updateWP(p.id, { opex_share: Number(e.target.value) })} />
                  <button className="icon" onClick={() => removeWP(p.id)} title="Delete"><Trash2 size={16} /></button>
                </div>
              ))}
              {!winningProducts.length && <p className="empty-text">No winning products yet. Click Add product to get started.</p>}
            </div>
          </div>

          {/* Payment Processors */}
          <div className="settings-card settings-full">
            <div className="section-head">
              <PanelTitle title="Payment processors" subtitle="Active processors are averaged for fee calculations across all winning products." />
              <button onClick={addProcessor}><Plus size={16} /> Add processor</button>
            </div>
            <div className="field-header processor-entity">
              <span>Name</span><span>% fee</span><span>Fixed fee</span><span>Fixed currency</span><span>FX %</span><span>Active</span><span></span>
            </div>
            <div className="entity-list">
              {processors.map(p => (
                <div className="entity processor-entity" key={p.id}>
                  <input value={p.name} onChange={e => updateProcessor(p.id, { name: e.target.value })} />
                  <input type="number" step="0.01" value={p.percent_fee} onChange={e => updateProcessor(p.id, { percent_fee: Number(e.target.value) })} />
                  <input type="number" step="0.01" value={p.fixed_fee} onChange={e => updateProcessor(p.id, { fixed_fee: Number(e.target.value) })} />
                  <select value={p.fixed_fee_currency} onChange={e => updateProcessor(p.id, { fixed_fee_currency: e.target.value })}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" step="0.01" value={p.conversion_fee_percent} onChange={e => updateProcessor(p.id, { conversion_fee_percent: Number(e.target.value) })} />
                  <label className="switch"><input type="checkbox" checked={p.active} onChange={e => updateProcessor(p.id, { active: e.target.checked })} /><span /></label>
                  <button className="icon" onClick={() => removeProcessor(p.id)} title="Delete"><Trash2 size={16} /></button>
                </div>
              ))}
              {!processors.length && <p className="empty-text">No processors yet. Add Shopify Payments, Stripe, or any processor you use.</p>}
            </div>
          </div>

          {/* Kill Profiles */}
          <div className="settings-card settings-full">
            <div className="section-head">
              <PanelTitle title="Kill rule profiles" subtitle="Each profile has its own set of rules. Rules define spend thresholds, conditions, and outcomes — kill or continue." />
              <button onClick={addKillProfile}><Plus size={16} /> Add profile</button>
            </div>
            <div className="entity-list">
              {killProfiles.map(profile => (
                <div className="kill-profile-card" key={profile.id}>
                  <div className="kill-profile-header">
                    <div className="kill-profile-meta">
                      <input
                        className="kill-profile-name"
                        value={profile.name}
                        onChange={e => updateKP(profile.id, { name: e.target.value })}
                        placeholder="Profile name"
                      />
                      <label className="field-inline">
                        <span>Test budget/day</span>
                        <input type="number" step="1" value={profile.test_budget_per_day}
                          onChange={e => updateKP(profile.id, { test_budget_per_day: Number(e.target.value) })} />
                      </label>
                    </div>
                    <div className="kill-profile-actions">
                      <button className="secondary small" onClick={() => addRule(profile.id)}><Plus size={14} /> Add rule</button>
                      <button className="icon" onClick={() => removeKP(profile.id)} title="Delete profile"><Trash2 size={16} /></button>
                    </div>
                  </div>

                  {(profile.rules || []).length > 0 && (
                    <div className="rules-list">
                      <div className="rules-header">
                        <span>Rule name</span><span>Spend at ($)</span><span>ROAS threshold</span><span>Condition</span><span>Outcome</span><span></span>
                      </div>
                      {(profile.rules || []).map(rule => (
                        <div className="rule-row" key={rule.id}>
                          <input value={rule.name} placeholder="e.g. No ATC by $30"
                            onChange={e => updateRule(profile.id, rule.id, { name: e.target.value })} />
                          <div className="rule-threshold">
                            <span className="threshold-prefix">$</span>
                            <input type="number" step="1" value={rule.spend_threshold}
                              onChange={e => updateRule(profile.id, rule.id, { spend_threshold: Number(e.target.value) })} />
                          </div>
                          <div className="rule-threshold">
                            {rule.condition === 'roas_below' ? (
                              <>
                                <span className="threshold-prefix">≤</span>
                                <input type="number" step="0.01" value={rule.roas_threshold ?? 1.28}
                                  onChange={e => updateRule(profile.id, rule.id, { roas_threshold: Number(e.target.value) })} />
                              </>
                            ) : (
                              <input disabled placeholder="N/A" style={{ opacity: 0.35 }} />
                            )}
                          </div>
                          <select value={rule.condition}
                            onChange={e => updateRule(profile.id, rule.id, { condition: e.target.value })}>
                            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <select value={rule.outcome}
                            onChange={e => updateRule(profile.id, rule.id, { outcome: e.target.value })}>
                            {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <button className="icon small-icon" onClick={() => removeRule(profile.id, rule.id)} title="Delete rule">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!(profile.rules || []).length && (
                    <p className="empty-text" style={{ marginTop: 10 }}>No rules yet. Click Add rule to define kill or continue conditions.</p>
                  )}
                </div>
              ))}
              {!killProfiles.length && <p className="empty-text">No kill profiles yet. Click Add profile to create one.</p>}
            </div>
          </div>
        </section>
      )}

      {/* CALCULATOR */}
      {activeTab === 'calculator' && (
        <>
          <section className="workspace-bar panel">
            <div>
              <div className="eyebrow">Current scenario</div>
              <h2>{scenarioName}</h2>
              <p>
                {productResults.length} winning product{productResults.length !== 1 ? 's' : ''} active
                {' '}· {processors.filter(p => p.active).length} processor{processors.filter(p => p.active).length !== 1 ? 's' : ''} active
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
                <Field label="Scenario name"><input value={scenarioName} onChange={e => setScenarioName(e.target.value)} /></Field>
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

              {selectedKillProfile && (selectedKillProfile.rules || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>
                    Rules — {selectedKillProfile.name}
                  </div>
                  <div className="rule-pills">
                    {(selectedKillProfile.rules || []).map(rule => (
                      <div key={rule.id} className={`rule-pill ${rule.outcome}`}>
                        <span className="rule-pill-name">{rule.name || `$${rule.spend_threshold} ${rule.condition}`}</span>
                        <span className={`rule-pill-outcome ${rule.outcome}`}>{rule.outcome === 'kill' ? 'Kill' : 'Continue'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="saved-scenarios">
                <div className="mini-title"><FolderOpen size={14} /> Saved scenarios</div>
                {scenarios.length
                  ? <div className="chips">{scenarios.map(s => <button key={s.id} className="chip" onClick={() => loadScenario(s)}>{s.name}</button>)}</div>
                  : <p className="empty-text">No saved scenarios yet. Configure and click Save scenario.</p>}
              </div>
            </div>

            <div className="panel">
              <PanelTitle title="Winning products" subtitle="Toggle which products contribute to your daily testing budget." />
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
                          <span className="product-meta">{p.currency} {p.daily_ad_spend}/day · ROAS {Number(p.roas).toFixed(2)} · {p.cogs_pct}% COGS</span>
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

          {/* Decision card */}
          <section className={`decision-card ${capacityStatus}`}>
            <div className="decision-main">
              <div>
                <div className="eyebrow">Main answer</div>
                <h2>Safe test capacity today</h2>
                <p>Based on your active winners and the max loss allowed per failed test.</p>
              </div>
              <div className="decision-number">
                <strong>{calcBusy ? '…' : safeCapacity}</strong>
                <span>new product{safeCapacity === 1 ? '' : 's'}</span>
              </div>
            </div>

            <div className="decision-summary">
              <div>
                <span>Winner profit available</span>
                <strong>{money(totalProfit)}/day</strong>
              </div>
              <div>
                <span>Max loss per failed test</span>
                <strong>{testBudget > 0 ? `${currSymbol}${testBudget.toFixed(2)}/day` : '—'}</strong>
              </div>
              <div>
                <span>Buffer after {safeCapacity} test{safeCapacity === 1 ? '' : 's'}</span>
                <strong className={bufferAfterSafe >= 0 ? 'positive' : 'negative'}>{money(bufferAfterSafe)}/day</strong>
              </div>
              <div>
                <span>Cash needed for next test</span>
                <strong>{nextTestShortfall > 0 ? money(nextTestShortfall) : money(0)}</strong>
              </div>
            </div>

            <div className="capacity-modes">
              <div>
                <span>Conservative</span>
                <strong>{conservativeCapacity}</strong>
                <small>Keeps 30% profit untouched</small>
              </div>
              <div className="active-mode">
                <span>Balanced</span>
                <strong>{safeCapacity}</strong>
                <small>Uses winner profit only</small>
              </div>
              <div>
                <span>Aggressive</span>
                <strong>{aggressiveCapacity}</strong>
                <small>Allows one test budget risk</small>
              </div>
            </div>

            <p className="decision-note">
              {safeCapacity > 0
                ? `You can run ${safeCapacity} new product test${safeCapacity === 1 ? '' : 's'} without going past today's winner profit. Running ${safeCapacity + 1} would need ${money(nextTestShortfall)} extra cash.`
                : `Your active winners do not cover one full test today. Lower the test budget, add more winning profit, or wait before testing.`}
            </p>
          </section>

          {/* Metrics */}
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
              <div className="metric-lbl">Max loss per failed test/day</div>
            </div>
          </div>

          {/* Per-product breakdown */}
          {productResults.length > 0 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle title="Per-product breakdown" subtitle="Individual cost split per active winning product. All values in display currency." />
              <div className="table-card" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th><th>Ad spend</th><th>Net sales</th><th>COGS</th>
                      <th>Payment fees</th><th>OPEX</th><th>Net profit/day</th><th>BER</th><th>Est. orders/day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productResults.map(p => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          {displayCurrency !== p.currency && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{p.currency} → {displayCurrency}</span>}
                        </td>
                        <td>{money(p.adSpend)}</td>
                        <td>{money(p.netSales)}</td>
                        <td>{money(p.cogs)}</td>
                        <td>{money(p.fees)}</td>
                        <td>{money(p.opex)}</td>
                        <td style={{ color: p.netProfit >= 0 ? '#047857' : '#b91c1c', fontWeight: 900 }}>{money(p.netProfit)}</td>
                        <td>{num(p.ber)}</td>
                        <td>{p.dailyOrders > 0 ? p.dailyOrders : '—'}</td>
                      </tr>
                    ))}
                    {productResults.length > 1 && (
                      <tr className="strong-row">
                        <td>Total</td>
                        <td>{money(productResults.reduce((s, p) => s + p.adSpend, 0))}</td>
                        <td>{money(productResults.reduce((s, p) => s + p.netSales, 0))}</td>
                        <td>{money(productResults.reduce((s, p) => s + p.cogs, 0))}</td>
                        <td>{money(productResults.reduce((s, p) => s + p.fees, 0))}</td>
                        <td>{money(productResults.reduce((s, p) => s + p.opex, 0))}</td>
                        <td style={{ color: totalProfit >= 0 ? '#047857' : '#b91c1c', fontWeight: 900 }}>{money(totalProfit)}</td>
                        <td>—</td><td>—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Scenario table */}
          {scenarioResults.length > 0 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle
                title="Store net profit — simultaneous tests"
                subtitle="Each column is one of your kill rules. Green = store positive, yellow = marginal, red = negative."
              />
              <div className="table-card" style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Tests running</th>
                      {scenarioResults.map(s => (
                        <th key={s.id}>
                          {s.label}
                          <span className="th-note">{s.note}</span>
                          <span className={`th-badge ${s.isKill ? 'kill' : 'continue'}`}>{s.isKill ? 'Kill' : 'Continue'}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4, 5].map(n => (
                      <tr key={n} className={n === 0 ? 'strong-row' : ''}>
                        <td>{n === 0 ? '0 — no testing' : `${n} test${n > 1 ? 's' : ''}`}</td>
                        {scenarioResults.map(s => {
                          const net = s.storeNets[n];
                          if (!s.isKill) {
                            return (
                              <td key={s.id}>
                                <span className="net-val">{money(net)}</span>
                                <span className="status-pill good">Self-funding</span>
                              </td>
                            );
                          }
                          const cls = net >= 0 ? 'good' : net >= -25 ? 'warn' : 'bad';
                          return (
                            <td key={s.id}>
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

          {/* Safe ceiling */}
          {scenarioResults.length > 0 && (
            <section className="panel wide" style={{ marginBottom: 16 }}>
              <PanelTitle title="Safe test ceiling" subtitle="Maximum simultaneous tests before going store-negative, by rule." />
              <div className="recommendation-grid" style={{ marginTop: 14, gridTemplateColumns: `repeat(${Math.min(scenarioResults.length, 4)}, 1fr)` }}>
                {scenarioResults.map(s => {
                  if (!s.isKill) {
                    return (
                      <div key={s.id} className="recommendation-card good">
                        <div className="recommendation-top">
                          <strong>∞</strong>
                          <span>{s.label}</span>
                        </div>
                        <p>Test is self-funding. {s.description}</p>
                        <small>No drag on winning products' profit.</small>
                      </div>
                    );
                  }
                  const max = Math.max(0, s.maxTests);
                  const cls = max >= 3 ? 'good' : max >= 1 ? 'ok' : 'bad';
                  const label = { good: 'Plenty of room', ok: 'Limited runway', bad: 'No headroom' }[cls];
                  return (
                    <div key={s.id} className={`recommendation-card ${cls}`}>
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
  return <div className="panel-title"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>;
}
function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

createRoot(document.getElementById('root')).render(<App />);
