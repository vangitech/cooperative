import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, logout } = useAuth();

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );

  if (!user) return <Navigate to="/login" replace />;

  if (user.status !== 'active')
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">Awaiting approval</h1>
          <p className="text-sm text-muted-foreground">
            {user.status === 'pending'
              ? 'Your membership application is under review. You will be able to sign in once an admin approves it.'
              : 'Your account is suspended. Please contact the cooperative for help.'}
          </p>
          <Button variant="outline" onClick={logout}>Sign out</Button>
        </div>
      </div>
    );

  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;

  return children;
}