import { useGatewayStore } from '../store/gateway';

/**
 * Ambient background that subtly shifts color based on operational state.
 * You feel it before you notice it.
 */
export function AmbientBg() {
  const notifications = useGatewayStore((s) => s.notifications);

  // Derive state from recent notifications
  const hasAlert = notifications.some(n => n.type === 'alert');
  const state = hasAlert ? 'alert' : 'ok';

  return <div className="ambient-bg" data-state={state} />;
}
