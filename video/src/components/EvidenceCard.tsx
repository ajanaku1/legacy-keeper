import type {ReactNode} from 'react';
import {palette} from '../constants';
import {mono} from '../fonts';

type EvidenceCardProps = {
  label: string;
  value: ReactNode;
  status?: 'verified' | 'warning' | 'failed';
};

export const EvidenceCard = ({label, value, status = 'verified'}: EvidenceCardProps) => {
  const accent = status === 'failed' ? palette.red : status === 'warning' ? palette.amber : palette.green;
  return (
    <div
      style={{
        padding: '24px 28px',
        background: palette.surface,
        border: `1px solid ${palette.line}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 16,
      }}
    >
      <div style={{color: palette.muted, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 12}}>
        {label.toUpperCase()}
      </div>
      <div style={{fontFamily: mono, fontSize: 21, lineHeight: 1.45, overflowWrap: 'anywhere'}}>{value}</div>
    </div>
  );
};
