/// <reference types="node" />
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultSimulationConfig, DEFAULT_LAUNCH_OPTIONS } from './src/data/simulationConfig.ts';
import { buildConfiguredSyntheticRun } from './src/data/syntheticRunGenerator.ts';
import type { LaunchOptions, ScenarioId, SimulationConfig } from './src/types/surveillance.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveConfigPayload(body: unknown): {
  config: SimulationConfig;
  launch: LaunchOptions;
  focusScenarioId: ScenarioId | null;
} {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const defaults = createDefaultSimulationConfig();
  const rawConfig = (rec.config && typeof rec.config === 'object' ? rec.config : {}) as Partial<SimulationConfig>;
  const rawLaunch = (rec.launch && typeof rec.launch === 'object' ? rec.launch : {}) as Partial<LaunchOptions>;

  const config: SimulationConfig = {
    ...defaults,
    ...rawConfig,
    session: { ...defaults.session, ...(rawConfig.session ?? {}), run_duration_s: 21600 },
    market: { ...defaults.market, ...(rawConfig.market ?? {}) },
    reproducibility: { ...defaults.reproducibility, ...(rawConfig.reproducibility ?? {}) },
    instruments: Array.isArray(rawConfig.instruments) && rawConfig.instruments.length > 0
      ? rawConfig.instruments
      : defaults.instruments,
    event_rates: { ...defaults.event_rates, ...(rawConfig.event_rates ?? {}) },
    book: { ...defaults.book, ...(rawConfig.book ?? {}) },
    timing: { ...defaults.timing, ...(rawConfig.timing ?? {}) },
    features: { ...defaults.features, ...(rawConfig.features ?? {}) },
    scenario: {
      ...defaults.scenario,
      ...(rawConfig.scenario ?? {}),
      scenario_instances: {
        ...defaults.scenario.scenario_instances,
        ...(rawConfig.scenario?.scenario_instances ?? {}),
      },
    },
    regimes: {
      ...defaults.regimes,
      ...(rawConfig.regimes ?? {}),
      intraday_profile: {
        ...defaults.regimes.intraday_profile,
        ...(rawConfig.regimes?.intraday_profile ?? {}),
      },
      volatility: {
        ...defaults.regimes.volatility,
        ...(rawConfig.regimes?.volatility ?? {}),
      },
      liquidity: {
        ...defaults.regimes.liquidity,
        ...(rawConfig.regimes?.liquidity ?? {}),
      },
    },
    validation: { ...defaults.validation, ...(rawConfig.validation ?? {}) },
  };

  const launch: LaunchOptions = {
    ...DEFAULT_LAUNCH_OPTIONS,
    ...rawLaunch,
  };

  const focusScenarioId = (typeof rec.focusScenarioId === 'string'
    ? rec.focusScenarioId
    : null) as ScenarioId | null;

  return { config, launch, focusScenarioId };
}

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'surveillance-lab' });
  });

  app.post('/api/runs/generate', (req, res) => {
    const { config, launch, focusScenarioId } = resolveConfigPayload(req.body);
    const dataset = buildConfiguredSyntheticRun(config, launch, focusScenarioId);
    res.json(dataset);
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Surveillance Lab server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
