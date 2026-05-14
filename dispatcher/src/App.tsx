import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import DispatcherLayout from "./pages/DispatcherLayout";
import IncidentHistoryPage from "./pages/IncidentHistoryPage";
import DirectMessagesPage from "./pages/DirectMessagesPage";
import NotificationsPage from "./pages/NotificationsPage";
import AdminPortalPage from "./pages/AdminPortalPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dispatcher" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/dispatcher" element={<DispatcherLayout />}>
              <Route index element={<div />} />
              <Route path="overview" element={<AdminPortalPage />} />
              <Route path="history" element={<IncidentHistoryPage />} />
              <Route path="chats" element={<DirectMessagesPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
