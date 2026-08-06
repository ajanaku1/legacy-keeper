import { type ReactNode } from 'react';
import { ApplicationShell } from '@/components/shell/ApplicationShell';

export default function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
