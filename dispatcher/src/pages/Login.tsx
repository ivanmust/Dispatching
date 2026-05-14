import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Shield } from 'lucide-react';

const PASSWORD_HINT = 'Min 8 characters, at least one letter and one number.';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role] = useState<'dispatcher'>('dispatcher');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        if (!email.trim()) {
          setError('Email is required.');
          return;
        }
        if (!password) {
          setError('Password is required.');
          return;
        }
        const ok = await login(email.trim(), password);
        if (!ok) setError('Invalid credentials or not a dispatcher account.');
        else navigate('/dispatcher');
      } else {
        if (!name.trim()) {
          setError('Full name is required.');
          return;
        }
        if (!email.trim()) {
          setError('Email is required.');
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          setError('Please enter a valid email address.');
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.');
          return;
        }
        if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) {
          setError('Password must contain letters and numbers.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        const ok = await register(name.trim(), email.trim(), password, role);
        if (!ok) setError('Registration failed. Email may already be in use.');
        else navigate('/dispatcher');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
    setConfirmPassword('');
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-1">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">CAD Dispatch</CardTitle>
          <CardDescription>
            {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                aria-label="Email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                aria-label="Password"
              />
              {mode === 'register' && (
                <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
              )}
            </div>
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
            <div className="flex flex-col gap-1 mt-2 text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={switchMode}
              >
                {mode === 'login' ? 'Create account' : 'Sign in instead'}
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => navigate('/change-password')}
              >
                Change password
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
