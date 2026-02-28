import { Dashboard } from '@/components/Dashboard';

export default function HomePage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted" style={{ color: '#8b98a5', marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
        Main Chat analytics and activity over time.
      </p>
      <Dashboard />
    </div>
  );
}
