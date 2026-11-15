import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FlatSwitch } from './features/globe/FlatSwitch';
import { SunControl } from './features/globe/SunControl';
import { api, checkHealth } from './api/client';
import { Button } from './components/Button';
import { Wordmark } from './components/Wordmark';
import { ChatLauncher } from './features/chat/ChatLauncher';
import { ExampleCases } from './features/examples/ExampleCases';
import { GlobeView } from './features/globe/GlobeView';
import { InvestigationPanel } from './features/investigate/InvestigationPanel';
import { LayerDock } from './features/layers/LayerDock';
import { useFrameSync } from './features/layers/useFrameSync';
import { MapJobToast } from './features/map/MapJobToast';
import { MapHint, MapToolbar } from './features/map/MapToolbar';
import { PlaceSearch } from './features/search/PlaceSearch';
import { needsNoArea, useStore } from './state/store';

// The map is only needed after the first hand-off, so its bundle loads lazily.
const MapView = lazy(() => import('./features/map/MapView').then((m) => ({ default: m.MapView })));

async function bootstrap() {
  const set = useStore.getState().set;
  if (!(await checkHealth())) {
    set({ server: 'offline', catalogError: "Can't reach the server. Start the backend and reload the page." });
    return;
  }
  set({ server: 'online' });
  try {
    const [variables, examples, datasets] = await Promise.all([api.listVariables(), api.listExamples(), api.listDatasets().catch(() => [])]);
    set({ variables, examples, datasets });
  } catch (e) {
    set({ catalogError: `Could not load the variable list: ${e instanceof Error ? e.message : 'unknown error'}. Reload the page to try again.` });
  }
}

export default function App() {
  const view = useStore((s) => s.view);
  const transition = useStore((s) => s.transition);
  const mapMounted = useStore((s) => s.mapMounted);
  const server = useStore((s) => s.server);
  const panelVisible = useStore((s) => !!s.bbox || needsNoArea(s) || s.panelRequested);
  const flat = useStore((s) => s.flat);
  const casesOpen = useStore((s) => s.casesOpen);
  // 2D-only mode never loads the globe (big textures, WebGL) until someone switches back to it.
  const [globeWanted, setGlobeWanted] = useState(!flat);
  useEffect(() => {
    if (!flat) setGlobeWanted(true);
  }, [flat]);

  useEffect(() => {
    bootstrap();
  }, []);
  // Mount the (hidden) map a few seconds after start: its code and the tiles under the globe's gaze load
  // in the background, so the first globe -> map hand-off is instant.
  useEffect(() => {
    if (server !== 'online' || mapMounted) return;
    const t = window.setTimeout(() => useStore.getState().set({ mapMounted: true }), 2500);
    return () => window.clearTimeout(t);
  }, [server, mapMounted]);
  // Variable layer frames are shared by the globe overlay and the map overlay.
  useFrameSync();

  const onMap = view === 'map';
  const showPanel = onMap && panelVisible;

  return (
    <div className="app" data-view={view} data-flat={flat}>
      {globeWanted && (
        <div className="layer layer--globe" data-visible={!onMap} aria-hidden={onMap}>
          <GlobeView />
        </div>
      )}
      {mapMounted && (
        <div className="layer layer--map" data-visible={onMap} aria-hidden={!onMap}>
          <ErrorBoundary label="map">
            <Suspense fallback={null}>
              <MapView />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      <Wordmark />
      <PlaceSearch />
      {server === 'offline' && (
        <div className="server-down" role="alert">
          <p className="server-down__title">Can't reach the server</p>
          <p className="server-down__text">Trend Detective needs its backend for every map layer, analysis and search. Start the backend, then reload.</p>
          <Button variant="primary" size="s" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}

      {!onMap && (
        <div className="overlay" data-busy={transition !== 'idle'}>
          <ExampleCases />
        </div>
      )}
      {!onMap && transition === 'idle' && <LayerDock besidePanel={false} onGlobe />}
      {!onMap && transition === 'idle' && <FlatSwitch />}
      {!onMap && transition === 'idle' && <SunControl />}
      {onMap && flat && casesOpen && (
        <div className="overlay overlay--flat">
          <ExampleCases />
        </div>
      )}
      {onMap && (
        <>
          <MapToolbar panelOpen={showPanel} />
          <MapHint />
          <LayerDock besidePanel={showPanel} />
          <MapJobToast besidePanel={showPanel} />
        </>
      )}
      {showPanel && <InvestigationPanel />}
      <ChatLauncher besidePanel={showPanel} />
    </div>
  );
}
