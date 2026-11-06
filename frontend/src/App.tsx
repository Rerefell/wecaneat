import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navigate } from 'react-router-dom';
import BatchList from './pages/BatchList';
import BatchDetail from './pages/BatchDetail';
import MemberDetail from './pages/MemberDetail';
import NotFound from './pages/NotFound';
import { AppShell } from './components/AppShell';
import { AdminLoginDialog } from './components/AdminLoginDialog';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster position="top-center" richColors />
        <BrowserRouter>
          <AdminLoginDialog />
          <AppShell>
            <Routes>
              <Route path="/" element={<BatchList />} />
              {/* 短链：/wecaneat 直接进到运费批次 */}
              <Route path="/wecaneat" element={<Navigate to="/batches/1" replace />} />
              <Route path="/batches/:id" element={<BatchDetail />} />
              <Route path="/batches/:id/members/:name" element={<MemberDetail />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App
