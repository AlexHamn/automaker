import { createFileRoute } from '@tanstack/react-router';
import { KnowledgeBaseView } from '@/components/views/knowledge-base-view';

export const Route = createFileRoute('/knowledge-base')({
  component: KnowledgeBaseView,
});
