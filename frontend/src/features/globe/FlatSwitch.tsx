import { Button } from '../../components/Button';
import { IconMap } from '../../components/icons';
import { useStore } from '../../state/store';

/** On the globe: switch to the 2D-only map (for slow computers, or people who just prefer a flat map). */
export function FlatSwitch() {
  const setFlat = useStore((s) => s.setFlat);
  return (
    <div className="flat-switch">
      <Button variant="quiet" size="s" onClick={() => setFlat(true)} title="Use the flat map instead of the globe. Remembered on this device." aria-label="2D map only">
        <IconMap /> <span className="flat-switch__label">2D map only</span>
      </Button>
    </div>
  );
}
