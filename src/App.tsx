import React, { useEffect, useMemo, useState } from 'react';
import { PREBUILT_RUNS } from './data/syntheticRunGenerator';
import { ReportArtifactMode, SyntheticDataset } from './types/surveillance';
import { RunHeader } from './components/RunHeader';
import { ConfigureDatasetTab } from './components/ConfigureDatasetTab';
import { SchemaExplorerTab } from './components/SchemaExplorerTab';
import { MarketViewTab } from './components/MarketViewTab';
import { DataQualityTab } from './components/DataQualityTab';
import { DetectorTab } from './components/DetectorTab';

type TabKey = 'configure' | 'schema' | 'market' | 'dq' | 'det';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'schema', label: 'Schema & isolation' },
  { key: 'configure', label: 'Configure synthetic dataset' },
  { key: 'market', label: 'Market view' },
  { key: 'dq', label: 'Data quality' },
  { key: 'det', label: 'Surveillance features' },
];

export default function App() {
  const [runs, setRuns] = useState<SyntheticDataset[]>(PREBUILT_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>(PREBUILT_RUNS[0].run_metadata.run_id);
  const [artifactMode, setArtifactMode] = useState<ReportArtifactMode>('evaluator');
  const [revealLabels, setRevealLabels] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabKey>('schema');
  const [focusedScenarioId, setFocusedScenarioId] = useState<string>('all');
  const [highlightParticipantId, setHighlightParticipantId] = useState<string | null>(null);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>(
    PREBUILT_RUNS[0].instrument_master.instrument_id
  );
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const activeRun = useMemo(
    () => runs.find((r) => r.run_metadata.run_id === selectedRunId) ?? runs[0],
    [runs, selectedRunId]
  );

  const activeInstruments = useMemo(
    () =>
      activeRun.instruments && activeRun.instruments.length > 0
        ? activeRun.instruments
        : [activeRun.instrument_master],
    [activeRun]
  );

  const effectiveInstrument = useMemo(
    () =>
      activeInstruments.find((i) => i.instrument_id === selectedInstrumentId) ??
      activeInstruments[0],
    [activeInstruments, selectedInstrumentId]
  );

  const marketOrderEvents = useMemo(
    () =>
      activeInstruments.length > 1
        ? activeRun.model_input.order_events.filter(
            (e) => e.instrument_id === effectiveInstrument.instrument_id
          )
        : activeRun.model_input.order_events,
    [activeInstruments.length, activeRun.model_input.order_events, effectiveInstrument.instrument_id]
  );

  const marketBookSnapshots = useMemo(
    () =>
      activeInstruments.length > 1
        ? activeRun.model_input.book_snapshots.filter(
            (b) => b.instrument_id === effectiveInstrument.instrument_id
          )
        : activeRun.model_input.book_snapshots,
    [activeInstruments.length, activeRun.model_input.book_snapshots, effectiveInstrument.instrument_id]
  );

  const marketScenarios = useMemo(() => {
    if (artifactMode !== 'evaluator') return [];
    return activeInstruments.length > 1
      ? activeRun.evaluator_bundle.scenario_manifest.filter(
          (s) => s.instrument_id === effectiveInstrument.instrument_id
        )
      : activeRun.evaluator_bundle.scenario_manifest;
  }, [
    artifactMode,
    activeInstruments.length,
    activeRun.evaluator_bundle.scenario_manifest,
    effectiveInstrument.instrument_id,
  ]);

  const sessionDurationSec = useMemo(() => {
    const cfgSession = (activeRun.run_metadata.config_json as { session?: { run_duration_s?: number } })?.session;
    if (cfgSession?.run_duration_s && cfgSession.run_duration_s > 0) {
      return cfgSession.run_duration_s;
    }
    const snaps = activeRun.model_input.book_snapshots;
    if (snaps.length > 0) {
      return Math.max(60, Math.round(snaps[snaps.length - 1].snapshot_timestamp_sec));
    }
    return 21600;
  }, [activeRun]);

  const runOptions = useMemo(
    () =>
      runs.map((r) => ({
        run_id: r.run_metadata.run_id,
        label: r.run_metadata.run_id,
        status: r.run_metadata.status,
      })),
    [runs]
  );

  const handleChangeArtifactMode = (mode: ReportArtifactMode) => {
    setArtifactMode(mode);
    if (mode === 'model_input') {
      // Strip reveal state & scenario zoom when entering label-free model_input mode
      setRevealLabels(false);
      setFocusedScenarioId('all');
    }
  };

  const handleToggleReveal = (next: boolean) => {
    if (artifactMode !== 'evaluator') return;
    setRevealLabels(next);
    if (!next) setFocusedScenarioId('all');
  };

  const handleSelectRun = (runId: string) => {
    setSelectedRunId(runId);
    const nextRun = runs.find((r) => r.run_metadata.run_id === runId);
    if (nextRun) setSelectedInstrumentId(nextRun.instrument_master.instrument_id);
    setFocusedScenarioId('all');
    setHighlightParticipantId(null);
  };

  const handleRunGenerated = (dataset: SyntheticDataset) => {
    setRuns((prev) => {
      const filtered = prev.filter((r) => r.run_metadata.run_id !== dataset.run_metadata.run_id);
      return [dataset, ...filtered];
    });
    setSelectedRunId(dataset.run_metadata.run_id);
    setSelectedInstrumentId(dataset.instrument_master.instrument_id);
    setFocusedScenarioId('all');
    setHighlightParticipantId(null);
  };

  const handleInspectInMarketView = (params: {
    scenarioId?: string;
    participantId?: string;
  }) => {
    if (params.scenarioId && artifactMode === 'evaluator' && revealLabels) {
      const scn = activeRun.evaluator_bundle.scenario_manifest.find(
        (s) => s.scenario_id === params.scenarioId
      );
      if (scn) {
        setSelectedInstrumentId(scn.instrument_id);
      }
      setFocusedScenarioId(params.scenarioId);
    }
    if (params.participantId) {
      setHighlightParticipantId(params.participantId);
    }
    setActiveTab('market');
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(TABS[(idx + 1) % TABS.length].key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length].key);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <RunHeader
          runs={runOptions}
          selectedRunId={activeRun.run_metadata.run_id}
          onSelectRun={handleSelectRun}
          runMetadata={activeRun.run_metadata}
          instrument={activeRun.instrument_master}
          instruments={activeInstruments}
          artifactMode={artifactMode}
          onChangeArtifactMode={handleChangeArtifactMode}
          revealLabels={revealLabels}
          onToggleReveal={handleToggleReveal}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
        />

        {/* Accessible Tabs with aria-selected */}
        <div
          role="tablist"
          aria-label="Report sections"
          className="flex flex-wrap items-center gap-2"
        >
          {TABS.map((t, idx) => {
            const isSelected = activeTab === t.key;
            return (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`panel-${t.key}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setActiveTab(t.key)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`px-4 py-2 min-h-[40px] text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--ink)] text-[var(--bg)] border-[var(--ink)]'
                    : 'bg-transparent text-[var(--mut)] border-[var(--ln)] hover:text-[var(--ink)] hover:border-[var(--mut)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Active Tab Panel */}
        <section
          id={`panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="bg-[var(--sf)] border border-[var(--ln)] rounded-xl p-4 sm:p-6"
        >
          {activeTab === 'configure' && (
            <ConfigureDatasetTab
              onRunGenerated={handleRunGenerated}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'schema' && <SchemaExplorerTab artifactMode={artifactMode} />}

          {activeTab === 'market' && (
            <MarketViewTab
              artifactMode={artifactMode}
              revealLabels={revealLabels}
              orderEvents={marketOrderEvents}
              bookSnapshots={marketBookSnapshots}
              scenarios={marketScenarios}
              orderScenarioMap={
                artifactMode === 'evaluator' ? activeRun.evaluator_bundle.order_scenario_map : {}
              }
              focusedScenarioId={focusedScenarioId}
              onChangeFocusedScenario={setFocusedScenarioId}
              highlightParticipantId={highlightParticipantId}
              onClearHighlightParticipant={() => setHighlightParticipantId(null)}
              darkMode={darkMode}
              sessionDurationSec={sessionDurationSec}
              instruments={activeInstruments}
              selectedInstrumentId={effectiveInstrument.instrument_id}
              onSelectInstrument={setSelectedInstrumentId}
            />
          )}

          {activeTab === 'dq' && (
            <DataQualityTab
              artifactMode={artifactMode}
              revealLabels={revealLabels}
              validationResults={activeRun.evaluator_bundle.validation_results}
              seededPassing={activeRun.evaluator_bundle.seeded_orders_passing_all_checks}
            />
          )}

          {activeTab === 'det' && (
            <DetectorTab
              artifactMode={artifactMode}
              revealLabels={revealLabels}
              features={activeRun.model_input.surveillance_features}
              scenarios={
                artifactMode === 'evaluator' ? activeRun.evaluator_bundle.scenario_manifest : []
              }
              onInspectInMarketView={handleInspectInMarketView}
            />
          )}
        </section>
      </main>
    </div>
  );
}
