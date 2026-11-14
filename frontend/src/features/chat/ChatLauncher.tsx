import { IconChat } from '../../components/icons';
import { useStore } from '../../state/store';
import { ChatDrawer } from './ChatDrawer';
import './chat.css';

/** Floating "Ask the field guide" button, bottom-right. Shifts left of the panel when the panel is open. */
export function ChatLauncher({ besidePanel }: { besidePanel: boolean }) {
  const open = useStore((s) => s.chatOpen);
  const set = useStore((s) => s.set);
  return (
    <div className="chat-dock" data-beside-panel={besidePanel}>
      {open && <ChatDrawer onClose={() => set({ chatOpen: false })} />}
      <button type="button" className="chat-launch" aria-expanded={open} onClick={() => set({ chatOpen: !open })}>
        <IconChat />
        <span>Ask the field guide</span>
      </button>
    </div>
  );
}
