import { UserProfile } from '@/components/UserProfile';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chatIds?: string }>;
}

export default async function UserByIdPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { chatIds: chatIdsParam } = await searchParams;
  const numId = parseInt(id, 10);
  if (Number.isNaN(numId)) {
    return (
      <div className="card">
        <p>Invalid user id.</p>
      </div>
    );
  }
  const initialChatIds =
    typeof chatIdsParam === 'string' && chatIdsParam.trim()
      ? chatIdsParam
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n) && n > 0)
      : undefined;
  return <UserProfile byId={numId} initialChatIds={initialChatIds} />;
}
