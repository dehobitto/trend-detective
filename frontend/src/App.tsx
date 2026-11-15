import { lazy, Suspense, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { api, initApi } from './api/client';
import { Badge } from './components/Badge';
import { Wordmark } from './components/Wordmark';
import { ChatLauncher } from './features/chat/ChatLauncher';
import { ExampleCases } from './features/examples/ExampleCases';
import { GlobeView } from './features/globe/GlobeView';
import { InvestigationPanel } from './features/investigate/InvestigationPanel';
import { LayerDock } from './features/layers/LayerDock';
import { useFrameSync } from './features/layers/useFrameSync';
import { MapHint, MapToolbar } from './features/map/MapToolbar';
import { PlaceSearch } from './features/search/PlaceSearch';
import { needsNoArea, useStore } from './state/store';

// The map is only needed after the first hand-off, so its bundle loads lazily.
const MapView = lazy(() => import('./features/map/MapView').then((m) => ({ default: m.MapView })));

async function bootstrap() {
  const set = useStore.getState().set;
  const mode = await initApi();
  set({ apiMode: mode });
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
  const apiMode = useStore((s) => s.apiMode);
  const panelVisible = useStore((s) => !!s.bbox || needsNoArea(s) || s.panelRequested);

  useEffect(() => {
    bootstrap();
  }, []);
  // Variable layer frames/mode are shared by the globe overlay and the map overlay.
  useFrameSync();

  const onMap = view === 'map';
  const showPanel = onMap && panelVisible;

  return (
    <div className="app" data-view={view}>
      <div className="layer layer--globe" data-visible={!onMap} aria-hidden={onMap}>
        <GlobeView />
      </div>
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
      {apiMode === 'mock' && (
        <div className="mode-note" title="The backend did not answer, so the app is using built-in synthetic data.">
          <Badge tone="demo">Offline demo</Badge>
        </div>
      )}

      {!onMap && (
        <div className="overlay" data-busy={transition !== 'idle'}>
          <ExampleCases />
        </div>
      )}
      {!onMap && transition === 'idle' && <LayerDock besidePanel={false} onGlobe />}
      {onMap && (
        <>
          <MapToolbar panelOpen={showPanel} />
          <MapHint />
          <LayerDock besidePanel={showPanel} />
        </>
      )}
      {showPanel && <InvestigationPanel />}
      <ChatLauncher besidePanel={showPanel} />
    </div>
  );
}
