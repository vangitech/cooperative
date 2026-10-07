import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import AdminLayout from '@/components/AdminLayout';
import { Toaster } from '@/components/ui/sonner';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import PaymentCallback from '@/pages/PaymentCallback';
import Dashboard from '@/pages/Dashboard';
import Wallet from '@/pages/Wallet';
import Savings from '@/pages/Savings';
import Loans from '@/pages/Loans';
import Dividends from '@/pages/Dividends';
import Profile from '@/pages/Profile';
import Market from '@/pages/Market';

import AdminDashboard from '@/pages/admin/AdminDashboard';
import AdminMembers from '@/pages/admin/AdminMembers';
import AdminLoans from '@/pages/admin/AdminLoans';
import AdminDividends from '@/pages/admin/AdminDividends';
import AdminTransactions from '@/pages/admin/AdminTransactions';
import AdminActivity from '@/pages/admin/AdminActivity';
import AdminStore from '@/pages/admin/AdminStore';
import AdminNotices from '@/pages/admin/AdminNotices';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/payment/callback" element={<PaymentCallback />} />

          {/* Member portal */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/savings" element={<Savings />} />
            <Route path="/loans" element={<Loans />} />
            <Route path="/dividends" element={<Dividends />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/market" element={<Market />} />
          </Route>

          {/* Admin console — separate shadcn layout */}
          <Route
            path="/admin"
            element={<ProtectedRoute adminOnly><AdminLayout /></ProtectedRoute>}
          >
            <Route index element={<AdminDashboard />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="loans" element={<AdminLoans />} />
            <Route path="dividends" element={<AdminDividends />} />
            <Route path="transactions" element={<AdminTransactions />} />
            <Route path="activity" element={<AdminActivity />} />
            <Route path="store" element={<AdminStore />} />
            <Route path="notices" element={<AdminNotices />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>

        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}