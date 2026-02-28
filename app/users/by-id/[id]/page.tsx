import { UserProfile } from '@/components/UserProfile';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserByIdPage({ params }: PageProps) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (Number.isNaN(numId)) {
    return (
      <div className="card">
        <p>Invalid user id.</p>
      </div>
    );
  }
  return <UserProfile byId={numId} />;
}
