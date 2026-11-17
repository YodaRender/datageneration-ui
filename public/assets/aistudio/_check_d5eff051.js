  "use strict";

  const SCENARIOS = [
    { id:"S01", name:"Large order, no fill", group:"Large-order patterns", role:"pattern", script:"large_order.py",
      family:"Large-order patterns", category:"Unfilled oversized resting order",
      desc:"Places a large order several ticks behind the touch and holds it without a fill.",
      knobs:["large_depth_multiple","difficulty","hold_duration_s"],
      fixed:["One order placed several ticks behind the touch; placement distance is fixed in the script."] },
    { id:"S02", name:"Large order, partial fill", group:"Large-order patterns", role:"pattern", script:"large_order.py",
      family:"Large-order patterns", category:"Partially executed oversized order",
      desc:"Large order that is allowed to fill part of its size, then continues as a large-order episode.",
      knobs:["large_depth_multiple","difficulty","display_duration_s","hold_duration_s"],
      fixed:["Fill fraction is fixed at 30–70%. Shared partial_fill_* settings do not control it."] },
    { id:"S03", name:"Large order, full fill", group:"Large-order patterns", role:"pattern", script:"large_order.py",
      family:"Large-order patterns", category:"Fully executed oversized order",
      desc:"Large order that attempts a full IOC fill against the book.",
      knobs:["large_depth_multiple","difficulty","display_duration_s"],
      fixed:["The script attempts a full IOC fill."] },
    { id:"S04", name:"Large order, quick cancel", group:"Large-order patterns", role:"pattern", script:"large_order.py",
      family:"Large-order patterns", category:"Short-lived oversized order",
      desc:"Large order displayed briefly, then cancelled.",
      knobs:["large_depth_multiple","difficulty","display_duration_s"],
      fixed:["Quick-cancel timing and placement distance are script-defined."] },
    { id:"S05", name:"Layering, gradual cancellation", group:"Layering patterns", role:"pattern", script:"layering.py",
      family:"Layering patterns", category:"Stacked depth withdrawn gradually",
      desc:"Builds a same-side ladder and cancels it in stages.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","hold_duration_s","partial_fill"],
      fixed:["Layer placement intervals and gradual cancel gaps are fixed."] },
    { id:"S06", name:"Persistent layered quoting", group:"Layering patterns", role:"control", script:"layering.py",
      family:"Benign look-alike controls", category:"Persistent layered quoting control",
      desc:"Leaves a layered quote in place on purpose. Actor blending is bypassed.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","hold_duration_s"],
      fixed:["It deliberately does not cancel its layers; actor blending is bypassed."] },
    { id:"S07", name:"Layering, rapid cancellation", group:"Layering patterns", role:"pattern", script:"layering.py",
      family:"Layering patterns", category:"Stacked depth withdrawn as a batch",
      desc:"Builds a ladder and cancels it as a rapid batch.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","display_duration_s","partial_fill"],
      fixed:["Cancellation is performed as a rapid batch."] },
    { id:"S08", name:"Layering with linked opposite-side trade", group:"Spoofing-like sequences", role:"pattern", script:"spoofing_like.py",
      family:"Spoofing-like sequences", category:"Ladder plus linked opposite-side execution",
      desc:"Layered orders plus a linked genuine trade on the opposite side.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","resting_time","partial_fill"],
      fixed:["Trade retries and fallback behavior are fixed in the script."] },
    { id:"S09", name:"Layering without linked trade", group:"Spoofing-like sequences", role:"pattern", script:"spoofing_like.py",
      family:"Spoofing-like sequences", category:"Ladder with no linked execution",
      desc:"Same layered construction without a linked opposite-side trade.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","resting_time","partial_fill"],
      fixed:["The no-linked-trade pattern is script-defined."] },
    { id:"S10", name:"Patient institutional large order", group:"Benign controls", role:"control", script:"large_order.py",
      family:"Benign look-alike controls", category:"Patient institutional control",
      desc:"Large-order control with slower, institutional-style replacement.",
      knobs:["large_depth_multiple","difficulty","hold_duration_s"],
      fixed:["Replacement timing and behavior are fixed."] },
    { id:"S11", name:"Market-maker quote updates", group:"Benign controls", role:"control", script:"controls.py",
      family:"Benign look-alike controls", category:"Market-maker quoting control",
      desc:"Repeated two-sided quote updates. High cancel activity is expected.",
      knobs:["blend_actors","latency_jitter"],
      fixed:["Update count (6–10), update gaps, and quote behavior are fixed. hft_cancel_rate_* does not control it."] },
    { id:"S12", name:"Legitimate two-sided multi-level quoting", group:"Benign controls", role:"control", script:"controls.py",
      family:"Benign look-alike controls", category:"Two-sided ladder control",
      desc:"Three levels per side with refresh behavior. Common layer_count does not change its ladder size.",
      knobs:["hold_duration_s","blend_actors"],
      fixed:["Three levels per side, refresh behavior, and order sizing are fixed."] },
    { id:"S13", name:"High-volatility burst", group:"Benign controls", role:"control", script:"controls.py",
      family:"Benign look-alike controls", category:"Volatility-shock control",
      desc:"Burst of aggressive flow on a high-volatility instrument.",
      knobs:["large_depth_multiple","difficulty"],
      extra:"Instrument regime is used; the type is planned onto the live book like the others.",
      fixed:["Shock count, spacing, and shock-order size range are fixed."] },
    { id:"S14", name:"Small order on an illiquid book", group:"Benign controls", role:"control", script:"large_order.py",
      family:"Benign look-alike controls", category:"Illiquid-book size control",
      desc:"Preferentially planned on low-liquidity instruments. Relative size comes from book depth, not the large-order multiple.",
      knobs:["hold_duration_s"],
      fixed:["Relative size is fixed from book depth; it does not use the shared large-order multiple."] },
    { id:"S15", name:"Coincidental-trade control", group:"Benign controls", role:"control", script:"spoofing_like.py",
      family:"Benign look-alike controls", category:"Unrelated trade near layered activity",
      desc:"Layered activity with an unrelated trade nearby. Actor blending is bypassed.",
      knobs:["layer_count","layer_price_step_ticks","layer_volume_decay","difficulty","resting_time","latency_jitter"],
      fixed:["Timing of the unrelated trade is script-defined; actor blending is bypassed."] },
    { id:"S16", name:"Feed-anomaly control", group:"Benign controls", role:"control", script:"controls.py",
      family:"Benign look-alike controls", category:"GAP / DUPLICATE / INCONSISTENT",
      desc:"Cycles GAP, DUPLICATE, and INCONSISTENT by instance order. There is no YAML selector for the kind.",
      knobs:["blend_actors","latency_jitter"],
      fixed:["Anomaly kind cycles through GAP, DUPLICATE, and INCONSISTENT by instance order."] }
  ];

  const state = {
    yaml: null,
    cfg: null,
    launch: { fmt: "parquet", out: "out/ui-runs", persist: false, gate: true },
    view: "run",
    activeId: null,
    busy: false
  };

  const $ = id => document.getElementById(id);
  const toast = (msg, err) => {
    const el = $("toast");
    el.textContent = msg;
    el.classList.toggle("error", !!err);
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 2400);
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function get(path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), state.cfg);
  }
    function set(path, value) {
    const keys = path.split(".");
    let o = state.cfg;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys.at(-1)] = value;
    refreshMeta();
    if (path === "market.instrument_count") renderInstruments();
    if (path.includes("scenario_instances") && state.view === "scenario") {
      $("sc-n").textContent = String(get(path) ?? 0);
      paintTimeline();
    }
  }

  function fmtNum(v, step) {
    if (typeof v !== "number") return String(v);
    const d = step && String(step).includes(".") ? String(step).split(".")[1].length : (Number.isInteger(v) ? 0 : 2);
    return v.toFixed(d);
  }

  function sliderKnob(spec) {
    const wrap = document.createElement("div");
    wrap.className = "knob" + (spec.disabled ? " is-disabled" : "");
    const range = spec.range;
    const keys = range || [spec.path];
    const min = spec.min, max = spec.max, step = spec.step ?? 1;
    wrap.innerHTML = '<div class="knob-top"><span class="knob-name"></span><span class="knob-value"></span></div>' +
      '<div class="knob-key"></div><div class="slider-wrap"><div class="slider-fill"></div></div>' +
      '<div class="slider-bounds"><span></span><span></span></div><p class="knob-hint"></p>';
    wrap.querySelector(".knob-name").textContent = spec.label;
    wrap.querySelector(".knob-key").textContent = keys.join(" / ");
    wrap.querySelector(".knob-hint").textContent = spec.hint || "";
    const bounds = wrap.querySelectorAll(".slider-bounds span");
    const fmt = spec.fmt || (v => fmtNum(v, step));
    bounds[0].textContent = fmt(min); bounds[1].textContent = fmt(max);
    const fill = wrap.querySelector(".slider-fill");
    const out = wrap.querySelector(".knob-value");
    const sliders = keys.map((path, i) => {
      const input = document.createElement("input");
      input.type = "range"; input.min = min; input.max = max; input.step = step;
      input.disabled = !!spec.disabled;
      input.value = get(path);
      input.addEventListener("input", () => {
        let val = parseFloat(input.value);
        if (range) {
          const other = parseFloat(sliders[1 - i].value);
          if (i === 0 && val > other) val = other;
          if (i === 1 && val < other) val = other;
          input.value = val;
        }
        set(path, Number(step) >= 1 && Number.isInteger(Number(step)) ? Math.round(val) : val);
        paint();
        if (state.view === "scenario") paintTimeline();
      });
      wrap.querySelector(".slider-wrap").append(input);
      return input;
    });
    const pct = v => ((v - min) / (max - min)) * 100;
    function paint() {
      const a = get(keys[0]), b = range ? get(keys[1]) : a;
      fill.style.left = (range ? pct(a) : 0) + "%";
      fill.style.width = (range ? pct(b) - pct(a) : pct(a)) + "%";
      out.textContent = range ? `${fmt(a)} – ${fmt(b)}` : fmt(a);
    }
    paint();
    return wrap;
  }

  function selectField(spec) {
    const el = document.createElement("div");
    el.className = "field";
    el.innerHTML = '<div class="field-row"><div><div class="knob-name"></div><div class="knob-key"></div></div></div><p class="knob-hint"></p>';
    el.querySelector(".knob-name").textContent = spec.label;
    el.querySelector(".knob-key").textContent = spec.path;
    el.querySelector(".knob-hint").textContent = spec.hint || "";
    const sel = document.createElement("select");
    spec.options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt; sel.append(o);
    });
    sel.value = get(spec.path);
    sel.disabled = !!spec.disabled;
    sel.addEventListener("change", () => { set(spec.path, sel.value); });
    el.querySelector(".field-row").append(sel);
    return el;
  }

  function textField(spec) {
    const el = document.createElement("div");
    el.className = "field";
    el.innerHTML = '<div class="field-row"><div><div class="knob-name"></div><div class="knob-key"></div></div></div><p class="knob-hint"></p>';
    el.querySelector(".knob-name").textContent = spec.label;
    el.querySelector(".knob-key").textContent = spec.path;
    el.querySelector(".knob-hint").textContent = spec.hint || "";
    const input = document.createElement("input");
    input.type = spec.type || "text";
    input.value = get(spec.path) ?? "";
    input.disabled = !!spec.disabled;
    if (spec.min != null) input.min = spec.min;
    if (spec.max != null) input.max = spec.max;
    if (spec.step != null) input.step = spec.step;
    input.addEventListener("change", () => {
      let v = input.value;
      if (spec.type === "number") v = v === "" ? null : Number(v);
      set(spec.path, v);
    });
    el.querySelector(".field-row").append(input);
    return el;
  }

  function toggleField(spec) {
    const el = document.createElement("div");
    el.className = "field";
    const label = document.createElement("label");
    label.className = "toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!get(spec.path);
    input.disabled = !!spec.disabled;
    input.addEventListener("change", () => set(spec.path, input.checked));
    const copy = document.createElement("span");
    copy.innerHTML = `<strong style="color:#dce5ef;font-weight:600">${spec.label}</strong> · <span class="knob-key">${spec.path}</span><br><span class="knob-hint">${spec.hint || ""}</span>`;
    label.append(input, copy);
    el.append(label);
    return el;
  }

  function card(title, sub, nodes) {
    const art = document.createElement("article");
    art.className = "control-card";
    const p = document.createElement("p"); p.className = "card-label"; p.textContent = title;
    const s = document.createElement("p"); s.className = "control-card-sub"; s.textContent = sub;
    art.append(p, s, ...nodes);
    return art;
  }

  function fillCard(el, title, sub, nodes) {
    el.replaceChildren();
    const p = document.createElement("p"); p.className = "card-label"; p.textContent = title;
    const s = document.createElement("p"); s.className = "control-card-sub"; s.textContent = sub;
    el.append(p, s, ...nodes);
  }

  let typeOpen = false;

  function renderTypeList() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "type-button";
    button.setAttribute("aria-current", String(typeOpen));
    button.innerHTML = '<span class="type-mark" aria-hidden="true">◈</span><span class="type-name">Spoofing and layering</span><span class="scenario-group-count">16</span>';
    button.addEventListener("click", openType);
    $("type-list").replaceChildren(button);
  }

  function openType() {
    if (typeOpen) return;
    typeOpen = true;
    $("empty-state").hidden = true;
    $("type-view").hidden = false;
    renderTypeList();
    setWindow("schema");
  }

  function setWindow(name) {
    state.view = name;
    for (const id of ["schema", "run", "scenarios"]) {
      $(`panel-window-${id}`).hidden = id !== name;
    }
    document.querySelectorAll(".window-tab").forEach(tab => {
      tab.setAttribute("aria-selected", String(tab.dataset.window === name));
    });
    if (name === "scenarios") {
      state.activeId = null;
      $("scenario-list-view").hidden = false;
      $("scenario-view").hidden = true;
      renderScenarioLibrary();
    }
    updateCrumbs();
  }

  function updateCrumbs() {
    if (!typeOpen) { crumbs(["Workspace"]); return; }
    const parts = ["Workspace", "Spoofing and layering"];
    if (state.view === "run") parts.push("Run settings");
    else if (state.view === "scenarios" && state.activeId) {
      const sc = SCENARIOS.find(s => s.id === state.activeId);
      parts.push("Scenarios", `${sc.id} · ${sc.name}`);
    } else if (state.view === "scenarios") parts.push("Scenarios");
    else parts.push("Schema");
    crumbs(parts);
  }

  function renderScenarioLibrary() {
    const host = $("scenario-groups");
    if (!host) return;
    const fragment = document.createDocumentFragment();
    for (const group of [...new Set(SCENARIOS.map(s => s.group))]) {
      const items = SCENARIOS.filter(s => s.group === group);
      const heading = document.createElement("div");
      heading.className = "group-heading";
      const title = document.createElement("span");
      title.textContent = group;
      const count = document.createElement("span");
      count.className = "scenario-group-count";
      count.textContent = String(items.length);
      heading.append(title, count);
      const grid = document.createElement("div");
      grid.className = "scenario-grid";
      for (const sc of items) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "scenario-card";
        const n = state.cfg?.scenario?.scenario_instances?.[sc.id] ?? 0;
        card.innerHTML = '<div class="card-top"><span class="card-code"></span><span class="count-chip"></span></div><div class="card-name"></div><p class="card-rule"></p>';
        card.querySelector(".card-code").textContent = sc.id;
        card.querySelector(".count-chip").textContent = `${n}×`;
        card.querySelector(".card-name").textContent = sc.name;
        card.querySelector(".card-rule").textContent = sc.desc;
        card.addEventListener("click", () => showScenario(sc.id));
        grid.append(card);
      }
      fragment.append(heading, grid);
    }
    host.replaceChildren(fragment);
  }

  function renderNav() {
    renderTypeList();
    if (typeOpen && state.view === "scenarios" && !state.activeId) renderScenarioLibrary();
  }

  function crumbs(parts) {
    const el = $("breadcrumb");
    el.replaceChildren();
    parts.forEach((t, i) => {
      if (i) { const s = document.createElement("span"); s.textContent = "/"; el.append(s); }
      const c = document.createElement("span");
      c.textContent = t;
      if (i === parts.length - 1) c.className = "breadcrumb-current";
      el.append(c);
    });
  }

  function refreshMeta() {
    if (!state.cfg) return;
    const sc = state.cfg.scenario;
    const total = Object.values(sc.scenario_instances || {}).reduce((a, b) => a + b, 0);
    $("m-seed").textContent = String(state.cfg.reproducibility.random_seed);
    const dur = state.cfg.session.run_duration_s;
    $("m-session").textContent = dur ? `${dur} s` : "full session";
    $("m-inst").textContent = `${total} across ${Object.keys(sc.scenario_instances).length} types`;
    $("m-diff").textContent = sc.difficulty;
    renderNav();
  }

  function renderInstruments() {
    const wrap = $("inst-wrap");
    const n = state.cfg.market.instrument_count;
    const rows = state.cfg.instruments.slice(0, Math.max(n, state.cfg.instruments.length));
    const table = document.createElement("table");
    table.className = "inst-table";
    table.innerHTML = "<thead><tr><th>ID</th><th>Symbol</th><th>Tick</th><th>Lot</th><th>Ref px</th><th>Vol</th><th>Liq</th></tr></thead>";
    const tb = document.createElement("tbody");
    rows.forEach((inst, idx) => {
      const tr = document.createElement("tr");
      if (idx >= n) tr.style.opacity = ".4";
      const fields = [
        ["instrument_id", "text"], ["symbol", "text"], ["tick_size", "text"],
        ["lot_size", "number"], ["reference_price", "text"]
      ];
      fields.forEach(([key, type]) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = type; input.value = inst[key] ?? "";
        input.addEventListener("change", () => {
          inst[key] = type === "number" ? Number(input.value) : input.value;
        });
        td.append(input); tr.append(td);
      });
      ["volatility_regime", "liquidity_regime"].forEach(key => {
        const td = document.createElement("td");
        const sel = document.createElement("select");
        ["LOW", "MEDIUM", "HIGH"].forEach(v => {
          const o = document.createElement("option"); o.value = v; o.textContent = v.toLowerCase(); sel.append(o);
        });
        sel.value = (inst[key] || state.cfg.market[key] || "MEDIUM").toString().toUpperCase();
        sel.addEventListener("change", () => { inst[key] = sel.value; });
        td.append(sel); tr.append(td);
      });
      tb.append(tr);
    });
    table.append(tb);
    wrap.replaceChildren(table);
  }

  function renderRunPanels() {
    fillCard($("card-session"), "Session", "Date, timezone, and optional shortened session.", [
      textField({ label: "Trading date", path: "session.trading_date", type: "date", hint: "session.trading_date" }),
      textField({ label: "Timezone", path: "session.timezone", hint: "IANA timezone for the session" }),
      sliderKnob({ label: "Run duration", path: "session.run_duration_s", min: 60, max: 1500, step: 30,
        fmt: v => `${v} s`, hint: "CLI --duration. Null in YAML means a full session; the console always sends a duration so runs stay bounded." })
    ]);
    fillCard($("card-market"), "Market", "How many names, and fallback regimes.", [
      sliderKnob({ label: "Instrument count", path: "market.instrument_count", min: 1, max: Math.max(1, state.cfg.instruments.length), step: 1,
        hint: "First N entries from instruments.yaml" }),
      selectField({ label: "Default volatility regime", path: "market.volatility_regime", options: ["LOW","MEDIUM","HIGH"] }),
      selectField({ label: "Default liquidity regime", path: "market.liquidity_regime", options: ["LOW","MEDIUM","HIGH"] }),
      sliderKnob({ label: "Random seed", path: "reproducibility.random_seed", min: 1, max: 9999, step: 1, hint: "CLI --seed / reproducibility.random_seed" })
    ]);
    renderInstruments();

    $("panel-rates").replaceChildren(card("Arrival mix", "cancel_rate + amend_rate must stay below 1.", [
      sliderKnob({ label: "Background events / s", path: "event_rates.background_events_per_second", min: 0.5, max: 40, step: 0.5, hint: "Per instrument, before regime multipliers" }),
      sliderKnob({ label: "Cancel rate", path: "event_rates.cancel_rate", min: 0, max: 0.9, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      sliderKnob({ label: "Amend rate", path: "event_rates.amend_rate", min: 0, max: 0.9, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      sliderKnob({ label: "Marketable share", path: "event_rates.marketable_share", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      sliderKnob({ label: "Market-order share", path: "event_rates.market_order_share", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      sliderKnob({ label: "Marketable IOC share", path: "event_rates.marketable_ioc_share", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` })
    ]), card("Participants & amends", "Uneven activity and amend mix.", [
      sliderKnob({ label: "Participant count", path: "event_rates.participant_count", min: 2, max: 80, step: 1 }),
      sliderKnob({ label: "Zipf exponent", path: "event_rates.participant_zipf_exponent", min: 0, max: 2.5, step: 0.05 }),
      sliderKnob({ label: "Amend qty-decrease share", path: "event_rates.amend_qty_decrease_share", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      sliderKnob({ label: "Amend price-change share", path: "event_rates.amend_price_change_share", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` })
    ]));

    $("panel-book").replaceChildren(card("Book & snapshots", "Output frequency and integrity checks.", [
      sliderKnob({ label: "Snapshot levels", path: "book.snapshot_levels_n", min: 1, max: 20, step: 1 }),
      selectField({ label: "Snapshot mode", path: "book.snapshot_mode", options: ["TIME","EVENT","BOTH"] }),
      sliderKnob({ label: "Snapshot interval", path: "book.snapshot_interval_ms", min: 100, max: 5000, step: 100, fmt: v => `${v} ms` }),
      selectField({ label: "Self-match prevention", path: "book.self_match_prevention",
        options: ["prevent-cancel-resting","prevent-cancel-incoming","allow"] }),
      sliderKnob({ label: "Full invariant interval", path: "book.full_invariant_check_interval", min: 0, max: 5000, step: 50 }),
      selectField({ label: "Internal precision", path: "timing.internal_precision", options: ["MICROSECOND","MILLISECOND"] }),
      selectField({ label: "Export precision", path: "timing.export_precision", options: ["MICROSECOND","MILLISECOND"] })
    ]), card("Features", "depth_convention is stored but unused. Sample rate is CLI --sample-rate.", [
      sliderKnob({ label: "Depth N", path: "features.depth_n", min: 1, max: 20, step: 1 }),
      sliderKnob({ label: "Depth band %", path: "features.depth_band_pct", min: 0.05, max: 5, step: 0.05 }),
      sliderKnob({ label: "Group gap", path: "features.group_gap_ms", min: 100, max: 10000, step: 100, fmt: v => `${v} ms` }),
      sliderKnob({ label: "Group max span", path: "features.group_max_span_ms", min: 1000, max: 120000, step: 1000, fmt: v => `${v} ms` }),
      sliderKnob({ label: "Trailing window", path: "features.trailing_window_ms", min: 0, max: 30000, step: 250, fmt: v => `${v} ms` }),
      sliderKnob({ label: "Background order sample rate", path: "features.background_order_sample_rate", min: 0.01, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
      selectField({ label: "Depth convention (unused)", path: "features.depth_convention", options: ["BEST","TOPN","BAND"], disabled: true,
        hint: "Accepted in config; generation does not switch on it." })
    ]));

    const instKnobs = SCENARIOS.map(sc => sliderKnob({
      label: `${sc.id} instances`, path: `scenario.scenario_instances.${sc.id}`, min: 0, max: 40, step: 1,
      hint: "Per-type count. --instances on the CLI would override all of these; this console does not."
    }));
    $("panel-scenario").replaceChildren(
      card("Placement", "Shared spacing through the session.", [
        sliderKnob({ label: "Scenario slot", path: "scenario.scenario_slot_s", min: 10, max: 180, step: 1, fmt: v => `${v} s` }),
        sliderKnob({ label: "Warm-up", path: "scenario.warmup_frac", min: 0, max: 0.4, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
        sliderKnob({ label: "Cool-down", path: "scenario.cooldown_frac", min: 0, max: 0.4, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
        selectField({ label: "Difficulty", path: "scenario.difficulty", options: ["easy","medium","hard","mixed"],
          hint: "Shared across types. mixed cycles those difficulties." })
      ]),
      card("Size, layers, timing", "Used only by scripts that call the shared helpers.", [
        sliderKnob({ label: "Large-order depth multiple", range: ["scenario.large_depth_multiple_min","scenario.large_depth_multiple_max"],
          min: 1, max: 20, step: 0.5, fmt: v => `${v.toFixed(1)}×` }),
        sliderKnob({ label: "Layer count", path: "scenario.layer_count", min: 2, max: 8, step: 1 }),
        sliderKnob({ label: "Layer price step", path: "scenario.layer_price_step_ticks", min: 1, max: 5, step: 1, fmt: v => `${v} tick` }),
        sliderKnob({ label: "Layer volume decay", path: "scenario.layer_volume_decay", min: 0.3, max: 1, step: 0.01 }),
        sliderKnob({ label: "Display duration", range: ["scenario.display_duration_s_min","scenario.display_duration_s_max"],
          min: 0.2, max: 20, step: 0.1, fmt: v => `${v} s` }),
        sliderKnob({ label: "Hold duration", range: ["scenario.hold_duration_s_min","scenario.hold_duration_s_max"],
          min: 1, max: 40, step: 0.5, fmt: v => `${v} s` })
      ]),
      card("Resting time, fills, jitter", "Eligible layered types only.", [
        selectField({ label: "Resting-time distribution", path: "scenario.resting_time_distribution", options: ["lognormal","uniform"] }),
        sliderKnob({ label: "Lognormal μ / σ", range: ["scenario.resting_time_lognormal_mu","scenario.resting_time_lognormal_sigma"],
          min: 0.05, max: 3, step: 0.05 }),
        sliderKnob({ label: "Resting-time bounds", range: ["scenario.resting_time_min_s","scenario.resting_time_max_s"],
          min: 0.05, max: 30, step: 0.05, fmt: v => `${v} s` }),
        toggleField({ label: "Partial fills enabled", path: "scenario.partial_fill_enabled", hint: "Does not control S02's 30–70% fill." }),
        sliderKnob({ label: "Partial-fill probability", path: "scenario.partial_fill_prob", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
        sliderKnob({ label: "Partial-fill ratio", range: ["scenario.partial_fill_min_ratio","scenario.partial_fill_max_ratio"],
          min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` }),
        toggleField({ label: "Latency jitter", path: "scenario.latency_jitter_enabled" }),
        sliderKnob({ label: "Jitter (ms)", range: ["scenario.latency_jitter_ms_min","scenario.latency_jitter_ms_max"],
          min: 0, max: 250, step: 1, fmt: v => `${v} ms` }),
        toggleField({ label: "Blend actors", path: "scenario.blend_actors", hint: "S06 and S15 bypass this." }),
        sliderKnob({ label: "HFT cancel rate (unused)", range: ["scenario.hft_cancel_rate_min","scenario.hft_cancel_rate_max"],
          min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%`, disabled: true,
          hint: "In the schema, not used by scenario scripts." })
      ]),
      card("Per-type instance counts", "This is the main per-type YAML setting.", instKnobs)
    );

    const volCards = ["LOW","MEDIUM","HIGH"].map(r => card(`Volatility · ${r.toLowerCase()}`, "Price-path and activity coupling.", [
      sliderKnob({ label: "σ bps / √s", path: `regimes.volatility.${r}.sigma_bps_per_sqrt_s`, min: 0.05, max: 4, step: 0.05 }),
      sliderKnob({ label: "Vol of vol", path: `regimes.volatility.${r}.vol_of_vol`, min: 0, max: 1, step: 0.01 }),
      sliderKnob({ label: "Vol persistence", path: `regimes.volatility.${r}.vol_persistence`, min: 0.9, max: 0.999, step: 0.001 }),
      sliderKnob({ label: "Activity exponent", path: `regimes.volatility.${r}.activity_exponent`, min: 0, max: 2, step: 0.05 })
    ]));
    const liqCards = ["LOW","MEDIUM","HIGH"].map(r => card(`Liquidity · ${r.toLowerCase()}`, "Depth, size, seed book, rate multiplier.", [
      sliderKnob({ label: "Depth scale", path: `regimes.liquidity.${r}.depth_scale`, min: 0.1, max: 5, step: 0.1 }),
      sliderKnob({ label: "Size median", path: `regimes.liquidity.${r}.size_median`, min: 5, max: 800, step: 5 }),
      sliderKnob({ label: "Size σ", path: `regimes.liquidity.${r}.size_sigma`, min: 0.1, max: 2, step: 0.05 }),
      sliderKnob({ label: "Size max", path: `regimes.liquidity.${r}.size_max`, min: 100, max: 50000, step: 100 }),
      sliderKnob({ label: "Half-spread ticks", path: `regimes.liquidity.${r}.half_spread_ticks`, min: 0, max: 8, step: 0.5 }),
      sliderKnob({ label: "Offset scale ticks", path: `regimes.liquidity.${r}.offset_scale_ticks`, min: 0.5, max: 12, step: 0.5 }),
      sliderKnob({ label: "Seed levels", path: `regimes.liquidity.${r}.seed_levels`, min: 1, max: 20, step: 1 }),
      sliderKnob({ label: "Seed orders / level", path: `regimes.liquidity.${r}.seed_orders_per_level`, min: 1, max: 8, step: 1 }),
      sliderKnob({ label: "Rate multiplier", path: `regimes.liquidity.${r}.rate_multiplier`, min: 0.1, max: 4, step: 0.1 })
    ]));
    $("panel-regimes").replaceChildren(
      card("Mean reversion & U-shape", "Intraday boosts near open and close.", [
        sliderKnob({ label: "Mean reversion / s", path: "regimes.mean_reversion_per_s", min: 0, max: 0.02, step: 0.0005 }),
        sliderKnob({ label: "Open boost", path: "regimes.intraday_profile.open_boost", min: 1, max: 6, step: 0.1 }),
        sliderKnob({ label: "Close boost", path: "regimes.intraday_profile.close_boost", min: 1, max: 6, step: 0.1 }),
        sliderKnob({ label: "Decay minutes", path: "regimes.intraday_profile.decay_minutes", min: 5, max: 90, step: 1 })
      ]),
      ...volCards, ...liqCards
    );

    const fmtSel = document.createElement("select");
    ["parquet", "csv"].forEach(v => { const o = document.createElement("option"); o.value = v; o.textContent = v; fmtSel.append(o); });
    fmtSel.value = state.launch.fmt;
    fmtSel.addEventListener("change", () => { state.launch.fmt = fmtSel.value; });
    const outInput = document.createElement("input");
    outInput.type = "text"; outInput.value = state.launch.out;
    outInput.addEventListener("change", () => { state.launch.out = outInput.value; });
    const gate = document.createElement("input"); gate.type = "checkbox"; gate.checked = state.launch.gate;
    gate.addEventListener("change", () => { state.launch.gate = gate.checked; });
    const persist = document.createElement("input"); persist.type = "checkbox"; persist.checked = state.launch.persist;
    persist.addEventListener("change", () => { state.launch.persist = persist.checked; });
    const launchCard = document.createElement("article");
    launchCard.className = "control-card";
    launchCard.innerHTML = '<p class="card-label">CLI-equivalent launch</p><p class="control-card-sub">Same flags as python -m surveillance_sim.cli generate. Export lands in this folder / run_id.</p>';
    const row = (label, control) => {
      const d = document.createElement("div"); d.className = "field";
      const fr = document.createElement("div"); fr.className = "field-row";
      const lab = document.createElement("div"); lab.className = "knob-name"; lab.textContent = label;
      fr.append(lab, control); d.append(fr); return d;
    };
    const gateLab = document.createElement("label"); gateLab.className = "toggle"; gateLab.append(gate, document.createTextNode(" Validation gate (off = --no-gate)"));
    const persistLab = document.createElement("label"); persistLab.className = "toggle"; persistLab.append(persist, document.createTextNode(" Persist to Postgres (needs DATABASE_URL)"));
    launchCard.append(
      row("Export format", fmtSel),
      row("Export directory", outInput),
      Object.assign(document.createElement("div"), { className: "field" }),
    );
    launchCard.lastChild.append(gateLab);
    const pfield = document.createElement("div"); pfield.className = "field"; pfield.append(persistLab);
    launchCard.append(pfield, toggleField({ label: "Replay check", path: "validation.replay_check" }),
      sliderKnob({ label: "Max regeneration attempts", path: "validation.max_regeneration_attempts", min: 0, max: 8, step: 1 }));
    const note = document.createElement("div");
    note.className = "notice";
    note.innerHTML = "<strong>Thresholds.yaml is not wired into generation.</strong> Detector cut-offs stay on <code>evaluate</code>. This console does not pretend they change the dataset.";
    const presets = document.createElement("article");
    presets.className = "control-card";
    presets.innerHTML = '<p class="card-label">Run size presets</p><p class="control-card-sub">YAML defaults are 25 instances per type — too many for a shortened console session. These only change counts and duration.</p>';
    const bar = document.createElement("div"); bar.className = "schema-view-tabs"; bar.style.marginTop = "8px";
    [["Quick", applyQuick], ["Makefile demo", applyDemo], ["YAML counts", applyYamlCounts]].forEach(([label, fn]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "schema-view-tab"; b.textContent = label;
      b.addEventListener("click", () => { fn(); renderRunPanels(); refreshMeta(); toast(label + " applied."); });
      bar.append(b);
    });
    presets.append(bar);
    $("panel-output").replaceChildren(launchCard, presets, note);
  }

  function applyQuick() {
    state.cfg.session.run_duration_s = 600;
    for (const k of Object.keys(state.cfg.scenario.scenario_instances)) state.cfg.scenario.scenario_instances[k] = 1;
  }
  function applyDemo() {
    state.cfg.session.run_duration_s = 1500;
    for (const k of Object.keys(state.cfg.scenario.scenario_instances)) state.cfg.scenario.scenario_instances[k] = 2;
  }
  function applyYamlCounts() {
    state.cfg.scenario.scenario_instances = clone(state.yaml.scenario.scenario_instances);
    state.cfg.session.run_duration_s = state.yaml.session.run_duration_s || 1500;
  }

  function showRun() {
    if (!typeOpen) openType();
    setWindow("run");
  }

  const KNOB_BUILDERS = {
    large_depth_multiple: () => sliderKnob({ label: "Large-order depth multiple", range: ["scenario.large_depth_multiple_min","scenario.large_depth_multiple_max"], min: 1, max: 20, step: 0.5, fmt: v => `${v.toFixed(1)}×`, hint: "Shared helper. Not used by S14." }),
    layer_count: () => sliderKnob({ label: "Layer count", path: "scenario.layer_count", min: 2, max: 8, step: 1, hint: "S12 ignores this and stays at three levels per side." }),
    layer_price_step_ticks: () => sliderKnob({ label: "Layer price step", path: "scenario.layer_price_step_ticks", min: 1, max: 5, step: 1, fmt: v => `${v} tick` }),
    layer_volume_decay: () => sliderKnob({ label: "Layer volume decay", path: "scenario.layer_volume_decay", min: 0.3, max: 1, step: 0.01 }),
    difficulty: () => selectField({ label: "Difficulty", path: "scenario.difficulty", options: ["easy","medium","hard","mixed"] }),
    display_duration_s: () => sliderKnob({ label: "Display duration", range: ["scenario.display_duration_s_min","scenario.display_duration_s_max"], min: 0.2, max: 20, step: 0.1, fmt: v => `${v} s` }),
    hold_duration_s: () => sliderKnob({ label: "Hold duration", range: ["scenario.hold_duration_s_min","scenario.hold_duration_s_max"], min: 1, max: 40, step: 0.5, fmt: v => `${v} s` }),
    partial_fill: () => sliderKnob({ label: "Partial-fill probability", path: "scenario.partial_fill_prob", min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%`, hint: "Requires partial_fill_enabled. Does not drive S02." }),
    resting_time: () => sliderKnob({ label: "Resting-time bounds", range: ["scenario.resting_time_min_s","scenario.resting_time_max_s"], min: 0.05, max: 30, step: 0.05, fmt: v => `${v} s` }),
    latency_jitter: () => sliderKnob({ label: "Latency jitter", range: ["scenario.latency_jitter_ms_min","scenario.latency_jitter_ms_max"], min: 0, max: 250, step: 1, fmt: v => `${v} ms` }),
    blend_actors: () => toggleField({ label: "Blend actors", path: "scenario.blend_actors" })
  };

  function sessionSeconds() {
    const d = state.cfg.session.run_duration_s;
    if (d) return d;
    return 6.25 * 3600;
  }

  function paintTimeline() {
    const sc = SCENARIOS.find(s => s.id === state.activeId);
    if (!sc) return;
    const cfg = state.cfg.scenario;
    const n = cfg.scenario_instances[sc.id] || 0;
    const SESSION = sessionSeconds();
    const warm = cfg.warmup_frac, cool = cfg.cooldown_frac;
    const activeFrac = Math.max(0, 1 - warm - cool);
    const nInst = state.cfg.market.instrument_count;
    const slots = Math.floor((activeFrac * SESSION) / cfg.scenario_slot_s) * nInst;
    const track = $("tl-track");
    track.replaceChildren();
    const mk = (cls, w) => { const e = document.createElement("div"); e.className = cls; e.style.width = w + "%"; track.append(e); return e; };
    mk("tl-warm", warm * 100);
    const act = mk("tl-active", activeFrac * 100);
    const shown = Math.min(n, Math.max(slots, 1));
    for (let i = 0; i < shown; i++) {
      const m = document.createElement("i"); m.className = "tl-mark";
      m.style.left = ((i + 0.5) / Math.max(shown, 1)) * 100 + "%"; act.append(m);
    }
    mk("tl-cool", cool * 100);
    const total = Object.values(cfg.scenario_instances).reduce((a,b) => a + b, 0);
    const over = total > slots;
    $("tl-legend").innerHTML = `<span>Warm-up ${Math.round(warm*100)}% · Active ${Math.round(activeFrac*100)}% · Cool-down ${Math.round(cool*100)}%</span>` +
      `<span class="${over ? "tl-warn" : ""}">${n} of this type · ${total} total instances · ~${slots} slots across ${nInst} instrument(s)</span>`;
  }

  function showScenario(id) {
    const sc = SCENARIOS.find(s => s.id === id);
    if (!sc) return;
    if (!typeOpen) {
      typeOpen = true;
      $("empty-state").hidden = true;
      $("type-view").hidden = false;
      renderTypeList();
    }
    state.view = "scenarios";
    state.activeId = id;
    for (const wid of ["schema", "run", "scenarios"]) $(`panel-window-${wid}`).hidden = wid !== "scenarios";
    document.querySelectorAll(".window-tab").forEach(tab => {
      tab.setAttribute("aria-selected", String(tab.dataset.window === "scenarios"));
    });
    $("scenario-list-view").hidden = true;
    $("scenario-view").hidden = false;
    updateCrumbs();
    $("sc-eyebrow").textContent = `${sc.id} · ${sc.group}`;
    $("sc-title").textContent = sc.name;
    $("sc-desc").textContent = sc.desc;
    $("sc-role").textContent = sc.role === "control" ? "Benign control" : "Pattern";
    $("sc-n").textContent = String(state.cfg.scenario.scenario_instances[sc.id] ?? 0);
    $("sc-knobs").textContent = sc.knobs.join(", ") || "none beyond instance count";
    $("sc-script").textContent = sc.script;
    $("sc-family").textContent = sc.family;
    $("sc-cat").textContent = sc.category;
    const role = $("sc-tax-role");
    role.textContent = sc.role === "control" ? "Benign look-alike control · not a positive abuse label" : "Manipulative-pattern test";
    role.classList.toggle("control", sc.role === "control");
    $("sc-fixed").replaceChildren(...sc.fixed.map(text => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="constraint-mark">◆</span><span></span>';
      li.querySelector("span:last-child").textContent = text;
      return li;
    }));
    fillCard($("sc-instance-card"), "This type only", "scenario_instances." + sc.id, [
      sliderKnob({ label: "Occurrences in this run", path: `scenario.scenario_instances.${sc.id}`, min: 0, max: 40, step: 1,
        hint: "How many instances of this script are planned." })
    ]);
    const shared = sc.knobs.map(k => KNOB_BUILDERS[k]?.()).filter(Boolean);
    fillCard($("sc-shared-card"), "Shared knobs that apply", "Changing these also affects other types that use the same helper.",
      shared.length ? shared : [Object.assign(document.createElement("p"), { className: "control-card-sub", textContent: "Only instance count is independently configurable for this type." })]);
    $("sc-note").innerHTML = `<strong>Locked in the script:</strong> ${sc.fixed[0]} Shared YAML still flows through the existing helpers — we are not adding per-type parameter blocks.`;
    const presets = $("count-presets");
    presets.replaceChildren(...[0, 1, 2, 5].map(n => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "schema-view-tab"; b.textContent = `${n}×`;
      b.addEventListener("click", () => {
        set(`scenario.scenario_instances.${sc.id}`, n);
        showScenario(sc.id);
      });
      return b;
    }));
    paintTimeline();
    renderNav();
    $("sc-n").textContent = String(state.cfg.scenario.scenario_instances[sc.id] ?? 0);
  }

  document.querySelectorAll("#panel-window-run .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#panel-window-run .tab").forEach(t => t.setAttribute("aria-selected", String(t === tab)));
      ["session","rates","book","scenario","regimes","output"].forEach(id => {
        $(`panel-${id}`).hidden = tab.dataset.tab !== id;
      });
    });
  });
  document.querySelectorAll(".window-tab").forEach(tab => {
    tab.addEventListener("click", () => setWindow(tab.dataset.window));
  });
  $("back-scenarios").addEventListener("click", () => setWindow("scenarios"));

  function overridesPayload() {
    const cfg = clone(state.cfg);
    const n = cfg.market.instrument_count;
    cfg.instruments = cfg.instruments.slice(0, n);
    if (!cfg.session.run_duration_s) cfg.session.run_duration_s = 600;
    // launch is not part of SimulationConfig
    delete cfg._launch;
    return {
      seed: cfg.reproducibility.random_seed,
      gate: state.launch.gate,
      persist: state.launch.persist,
      fmt: state.launch.fmt,
      out: `${state.launch.out}`,
      overrides: cfg
    };
  }

  async function validate() {
    const res = await fetch("/api/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(overridesPayload()) });
    const data = await res.json();
    if (!data.ok) { toast(data.error || "Invalid config", true); $("capacity-line").textContent = data.error; return data; }
    const c = data.capacity;
    $("capacity-line").textContent = `~${c.slots_per_instrument} slots × ${c.instruments} names ≈ ${c.approx_capacity} capacity · ${c.requested_instances} instances requested · session ${Math.round(c.session_s)} s`;
    if (c.requested_instances > c.approx_capacity) toast("Requested instances may not fit the session slots.", true);
    else toast("Config validates against the current schema.");
    return data;
  }

  function setBusy(on) {
    state.busy = on;
    $("live-dot").classList.toggle("busy", on);
    $("live-label").textContent = on ? "Generating…" : "Generator console";
    $("btn-run").disabled = on; $("btn-run-one").disabled = on; $("btn-validate").disabled = on;
  }

  async function generate(focusId) {
    if (state.busy) return;
    const snapshot = clone(state.cfg.scenario.scenario_instances);
    if (focusId) {
      for (const k of Object.keys(state.cfg.scenario.scenario_instances)) {
        state.cfg.scenario.scenario_instances[k] = k === focusId ? Math.max(1, state.cfg.scenario.scenario_instances[k] || 1) : 0;
      }
    }
    const body = overridesPayload();
    if (focusId) state.cfg.scenario.scenario_instances = snapshot;
    setBusy(true);
    const log = $("log");
    log.hidden = false; log.textContent = "";
    $("result").hidden = true;
    try {
      const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "log") log.textContent += msg.message + "\n";
          if (msg.type === "error") {
            log.textContent += "ERROR " + msg.error + "\n";
            toast(msg.error, true);
            if (msg.report) renderResult({ passed: false, summary: msg.report.summary, counts: {}, failures: msg.report.results?.filter(r => r.status === "FAIL") });
          }
          if (msg.type === "done") {
            renderResult(msg);
            toast(msg.passed ? `Exported ${msg.run_id}` : `Finished with validation issues`);
          }
          log.scrollTop = log.scrollHeight;
        }
      }
    } catch (err) {
      toast(String(err), true);
      log.textContent += String(err);
    } finally {
      setBusy(false);
    }
  }

  function renderResult(msg) {
    const el = $("result");
    el.hidden = false;
    const counts = msg.counts || {};
    el.innerHTML = `<div class="result-grid">
      ${[["Run", msg.run_id || "—"],["Gate", msg.passed ? "PASSED" : "FAILED"],["Events", counts.events],["Trades", counts.trades],["Features", counts.features],["Manifests", counts.manifests]].map(([k,v]) =>
        `<article class="metadata-card"><span class="metadata-label">${k}</span><span class="metadata-value">${v ?? "—"}</span></article>`).join("")}
    </div>
    <p class="section-caption" style="margin-top:12px">${msg.out ? "Exported to " + msg.out : ""} ${msg.config_hash ? " · hash " + msg.config_hash.slice(0,12) : ""}</p>`;
  }

  $("btn-validate").addEventListener("click", () => validate());
  $("btn-run").addEventListener("click", () => generate(null));
  $("btn-run-one").addEventListener("click", () => generate(state.activeId));
  $("btn-yaml").addEventListener("click", () => {
    state.cfg = clone(state.yaml);
    if (state.cfg.session.run_duration_s == null) state.cfg.session.run_duration_s = 600;
    renderRunPanels(); refreshMeta(); toast("Reloaded YAML defaults (duration kept at 600s for console runs).");
  });

  // Launch toggles: bind after first load via event delegation
  document.addEventListener("change", e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLSelectElement)) return;
    // fmt/out handled in render with fake paths — patch below
  });

  async function boot() {
    try {
      const res = await fetch("/api/defaults");
      const data = await res.json();
      state.yaml = data.config;
      state.cfg = clone(data.config);
      applyQuick();
      $("conn-pill").textContent = "Connected · configs/default.yaml";
      renderRunPanels();
      refreshMeta();
      if (typeof initMasterSchema === "function") initMasterSchema();
      renderTypeList();
      crumbs(["Workspace"]);
      $("capacity-line").textContent = "Quick preset: 600s session, 1 instance per type. Validate before a long run.";
    } catch (err) {
      $("conn-pill").textContent = "Open via python scripts/run_console.py";
      toast("Could not load /api/defaults. Start the console server.", true);
    }
  }

  boot();
  