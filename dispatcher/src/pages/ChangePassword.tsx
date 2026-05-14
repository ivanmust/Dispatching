import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function ChangePassword() {
  const navigate = useNavigate();
  const [forgotMode, setForgotMode] = useState(false);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      if (forgotMode) {
        await api.resetPassword({ username: email, newPassword });
        setSuccess('Password reset successfully. You can now log in with the new password.');
      } else {
        await api.changePassword({ email, currentPassword, newPassword });
        setSuccess('Password changed successfully. You can now log in with the new password.');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => navigate('/login'), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('403') || msg.toLowerCase().includes('disabled')
          ? 'Password reset is not enabled. Contact your administrator.'
          : forgotMode
            ? 'User not found or reset is disabled.'
            : 'Current password is incorrect or user not found.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-xl">Change Password</CardTitle>
          <CardDescription>
            {forgotMode ? 'Enter your email to set a new password (no current password needed).' : 'Use your current password to set a new one.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            {!forgotMode && (
            <div>
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            )}
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-emerald-600">{success}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (forgotMode ? 'Resetting...' : 'Changing password...') : forgotMode ? 'Reset password' : 'Change password'}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-primary mt-1"
              onClick={() => { setForgotMode(!forgotMode); setError(''); }}
            >
              {forgotMode ? 'I know my current password' : 'I forgot my current password'}
            </button>
            <button
              type="button"
              className="w-full text-xs text-primary underline mt-1"
              onClick={() => navigate('/login')}
            >
              Back to login
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

