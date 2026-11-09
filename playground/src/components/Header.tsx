import { Flex, Typography } from '@neo4j-ndl/react';

import { useIsMobile } from '../hooks/useIsMobile';
import { EngineInfoPopover } from './EngineInfoPopover';
import { RelateMark } from './RelateMark';

interface Props {
  engineReady: boolean;
  resetting: boolean;
  onReset: () => void;
}

export function Header({ engineReady, resetting, onReset }: Props) {
  const isMobile = useIsMobile();
  return (
    <Flex
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap="16"
      className="n-shrink-0 n-border-b n-border-neutral-border-weak n-bg-neutral-bg-weak"
      style={{ height: 56, paddingLeft: isMobile ? 12 : 24, paddingRight: isMobile ? 8 : 16 }}
    >
      <Flex flexDirection="row" gap="12" alignItems="center" className="n-shrink-0 n-min-w-0">
        {/* The site's brand: logomark + `relate` wordmark in Relate Mono, linking home. */}
        <a
          href="/"
          title="relate home"
          className="n-shrink-0 n-text-neutral-text-default"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginLeft: isMobile ? 0 : 10,
            textDecoration: 'none',
          }}
        >
          <RelateMark style={{ height: 24, width: 'auto', flexShrink: 0 }} />
          <span style={{ fontFamily: "'Relate Mono', ui-monospace, monospace", fontWeight: 500, fontSize: 16 }}>
            relate
          </span>
        </a>
        <Typography
          variant={isMobile ? 'subheading-medium' : 'title-4'}
          className="n-text-neutral-text-weak"
          style={{ whiteSpace: 'nowrap' }}
        >
          Playground
        </Typography>
      </Flex>
      <EngineInfoPopover
        engineReady={engineReady}
        resetting={resetting}
        onReset={onReset}
      />
    </Flex>
  );
}
