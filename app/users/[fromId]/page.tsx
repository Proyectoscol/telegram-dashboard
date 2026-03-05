import { UserProfile } from '@/components/UserProfile';

interface PageProps {
  params: Promise<{ fromId: string }>;
  searchParams: Promise<{ chatIds?: string }>;
}

export default async function UserPage({ params, searchParams }: PageProps) {
  const { fromId } = await params;
  const { chatIds: chatIdsParam } = await searchParams;
  const initialChatIds =
    typeof chatIdsParam === 'string' && chatIdsParam.trim()
      ? chatIdsParam
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n) && n > 0)
      : undefined;
  return <UserProfile fromId={decodeURIComponent(fromId)} initialChatIds={initialChatIds} />;
}
