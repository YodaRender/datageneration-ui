from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / "run_configurator.html").read_text(encoding="utf-8")
panel = (root / "schema_panel.html").read_text(encoding="utf-8")

start = html.index('<aside class="sidebar">')
end = html.index("</aside>") + len("</aside>")
sidebar = """<aside class="sidebar" aria-label="Market abuse type">
        <h2 class="sidebar-title">Market abuse type</h2>
        <p class="sidebar-caption">1 type available</p>
        <nav class="scenario-list" id="type-list"></nav>
        <div class="sidebar-footer">Spoofing and layering opens onto the shared master schema, then run settings and the scenario library.</div>
      </aside>"""
html = html[:start] + sidebar + html[end:]

a = html.index('<div class="breadcrumb" id="breadcrumb"></div>')
b = html.index("</div>\n      </main>")
inner = html[a:b]
run_start = inner.index('<section class="workspace">')
run_end = inner.index('<section id="scenario-view"')
run_block = inner[run_start:run_end]
detail = inner[run_end:]
detail = detail.replace(
    'id="back-run" type="button">← Run settings',
    'id="back-scenarios" type="button">← All scenarios',
)
detail = detail.replace('<section id="scenario-view" hidden>', '<div id="scenario-view" hidden>')
detail = detail.rstrip()
if not detail.endswith("</section>"):
    raise SystemExit("unexpected detail ending: " + detail[-80:])
detail = detail[: detail.rfind("</section>")] + "</div>\n"

new = f"""<div class="breadcrumb" id="breadcrumb"></div>
          <section class="empty-state" id="empty-state">
            <div class="empty-mark" aria-hidden="true">◈</div>
            <h1>Select a market abuse type</h1>
            <p>Choose Spoofing and layering to open its master schema, run settings, and scenario library.</p>
          </section>
          <div id="type-view" hidden>
            <div class="hero">
              <div>
                <div class="eyebrow">Market abuse type</div>
                <h1>Spoofing and layering</h1>
                <p class="hero-description">Order-book patterns, layered depth, and the benign look-alikes beside them. The schema is shared. Run settings are the YAML knobs that drive this generator.</p>
              </div>
              <div class="schema-badge"><span aria-hidden="true">◈</span><span>SCHEMA · RUN · SCENARIOS</span></div>
            </div>
            <div class="metadata-grid">
              <article class="metadata-card"><span class="metadata-label">Seed</span><span class="metadata-value" id="m-seed">—</span></article>
              <article class="metadata-card"><span class="metadata-label">Session</span><span class="metadata-value" id="m-session">—</span></article>
              <article class="metadata-card"><span class="metadata-label">Instances</span><span class="metadata-value" id="m-inst">—</span></article>
              <article class="metadata-card"><span class="metadata-label">Difficulty</span><span class="metadata-value" id="m-diff">—</span></article>
            </div>
            <section class="workspace" aria-label="Type windows">
              <div class="tab-list" role="tablist" aria-label="Type windows">
                <button class="tab window-tab" data-window="schema" aria-selected="true" type="button">Schema</button>
                <button class="tab window-tab" data-window="run" aria-selected="false" type="button">Run settings</button>
                <button class="tab window-tab" data-window="scenarios" aria-selected="false" type="button">Scenarios</button>
              </div>
              <section class="panel" id="panel-window-schema">
{panel}
              </section>
              <section class="panel" id="panel-window-run" hidden>
{run_block}
              </section>
              <section class="panel" id="panel-window-scenarios" hidden>
                <div id="scenario-list-view">
                  <h2 class="section-heading">Scenario library</h2>
                  <p class="section-caption">Sixteen scripts. Instance count is the only per-type setting. Shared knobs live on the scenario and on Run settings.</p>
                  <div id="scenario-groups"></div>
                </div>
{detail}
              </section>
            </section>
          </div>
"""
html = html[:a] + new + html[b:]
html = html.replace(
    '<script>\n  "use strict";',
    '<script src="schema_studio.js"></script>\n  <script>\n  "use strict";',
    1,
)
(root / "run_configurator.html").write_text(html, encoding="utf-8")
print("ok", html.count("panel-window-schema"), html.count("scenario-groups"))
