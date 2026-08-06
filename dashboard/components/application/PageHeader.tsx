import { type ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  status?: ReactNode;
}

export function PageHeader(props: PageHeaderProps) {
  return (
    <header className="page-head">
      <div>
        <span className="section-label">{props.eyebrow}</span>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.status}
    </header>
  );
}
