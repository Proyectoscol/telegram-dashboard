import { UserProfile } from '@/components/UserProfile';

interface PageProps {
  params: Promise<{ fromId: string }>;
}

export default async function UserPage({ params }: PageProps) {
  const { fromId } = await params;
  return <UserProfile fromId={decodeURIComponent(fromId)} />;
}
