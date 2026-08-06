import { PageHeader } from '@/components/application/PageHeader';
import { ExecutionRecord } from '@/components/ExecutionRecord';

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="KeeperHub evidence"
        description="Failed attempts stay beside recovered attempts. A later success does not erase the route before it."
        status={<span className="status-chip">● Live audit</span>}
      />
      <ExecutionRecord />
    </>
  );
}
