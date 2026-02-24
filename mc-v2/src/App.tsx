import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useThemeStore } from './store/theme';
import { useGatewayStore } from './store/gateway';
import { useIsMobile } from './hooks/useIsMobile';
import { Header } from './components/Header';
import { MobileHeader } from './components/MobileHeader';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { BottomBar } from './components/BottomBar';
import { MobileTabBar } from './components/MobileTabBar';
import { Particles } from './components/Particles';
import { AmbientBg } from './components/AmbientBg';
import { Dashboard } from './views/Dashboard';
import { Production } from './views/Production';
import { Trading } from './views/Trading';
import { MobileDashboard } from './views/MobileDashboard';
import { MobileFleet } from './views/MobileFleet';
import { MobileFeed } from './views/MobileFeed';
import { Placeholder } from './views/Placeholder';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

function AppShell() {
  const theme = useThemeStore((s) => s.theme);
  const connect = useGatewayStore((s) => s.connect);
  const connectionState = useGatewayStore((s) => s.connectionState);
  const isMobile = useIsMobile();

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    connect();
    return () => {
      useGatewayStore.getState().disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isMobile) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          height: '100dvh',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <AmbientBg />
        <MobileHeader connectionState={connectionState} />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<MobileDashboard />} />
            <Route path="/fleet" element={<MobileFleet />} />
            <Route path="/feed" element={<MobileFeed />} />
            <Route path="/tasks" element={<Placeholder title="Tasks" />} />
            <Route path="/production" element={<Placeholder title="Production" />} />
            <Route path="/trading" element={<Placeholder title="Trading" />} />
            <Route path="/monitor" element={<Placeholder title="Monitor" />} />
            <Route path="/system" element={<Placeholder title="System" />} />
          </Routes>
        </main>
        <MobileTabBar />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <Particles />
      <AmbientBg />
      <Header connectionState={connectionState} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <LeftSidebar />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/production" element={<Production />} />
            <Route path="/trading" element={<Trading />} />
            <Route path="/tasks" element={<Placeholder title="Tasks" />} />
            <Route path="/monitor" element={<Placeholder title="Monitor" />} />
            <Route path="/system" element={<Placeholder title="System" />} />
          </Routes>
        </main>
        <RightSidebar />
      </div>
      <BottomBar />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
