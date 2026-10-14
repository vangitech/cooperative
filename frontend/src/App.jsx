import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import AdminLayout from '@/components/AdminLayout';
import { Toaster } from '@/components/ui/sonner';

const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const PaymentCallback = lazy(() => import('@/pages/PaymentCallback'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const Savings = lazy(() => import('@/pages/Savings'));
const Loans = lazy(() => import('@/pages/Loans'));
const Dividends = lazy(() => import('@/pages/Dividends'));
const Profile = lazy(() => import('@/pages/Profile'));
const Verification = lazy(() => import('@/pages/Verification'));
const Market = lazy(() => import('@/pages/Market'));
const Statement = lazy(() => import('@/pages/Statement'));

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminMembers = lazy(() => import('@/pages/admin/AdminMembers'));
const AdminLoans = lazy(() => import('@/pages/admin/AdminLoans'));
const AdminDividends = lazy(() => import('@/pages/admin/AdminDividends'));
const AdminTransactions = lazy(() => import('@/pages/admin/AdminTransactions'));
const AdminActivity = lazy(() => import('@/pages/admin/AdminActivity'));
const AdminStore = lazy(() => import('@/pages/admin/AdminStore'));
const AdminNotices = lazy(() => import('@/pages/admin/AdminNotices'));
const AdminReports = lazy(() => import('@/pages/admin/AdminReports'));
const AdminOrgs = lazy(() => import('@/pages/admin/AdminOrgs'));
const AdminReconcile = lazy(() => import('@/pages/admin/AdminReconcile'));
const AdminCompliance = lazy(() => import('@/pages/admin/AdminCompliance'));
const AdminStaff = lazy(() => import('@/pages/admin/AdminStaff'));
const AdminKYC = lazy(() => import('@/pages/admin/AdminKYC'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
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
              <Route path="/verification" element={<Verification />} />
              <Route path="/market" element={<Market />} />
              <Route path="/statement" element={<Statement />} />
            </Route>

            {/* Admin console — separate shadcn layout */}
            <Route
              path="/admin"
              element={<ProtectedRoute adminOnly><AdminLayout /></ProtectedRoute>}
            >
              <Route index element={<AdminDashboard />} />
              <Route path="members" element={<AdminMembers />} />
              <Route path="kyc" element={<AdminKYC />} />
              <Route path="staff" element={<AdminStaff />} />
              <Route path="loans" element={<AdminLoans />} />
              <Route path="dividends" element={<AdminDividends />} />
              <Route path="transactions" element={<AdminTransactions />} />
              <Route path="activity" element={<AdminActivity />} />
              <Route path="store" element={<AdminStore />} />
              <Route path="notices" element={<AdminNotices />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="compliance" element={<AdminCompliance />} />
              <Route path="organisations" element={<AdminOrgs />} />
              <Route path="reconcile" element={<AdminReconcile />} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>

        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
