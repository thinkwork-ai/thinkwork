import React from 'react';

interface AnimatedEntryProps {
  animate?: boolean;
  children: React.ReactNode;
}

const keyframes = `@keyframes bubbleSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = keyframes;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function AnimatedEntry({ animate, children }: AnimatedEntryProps) {
  if (!animate) return <>{children}</>;

  injectStyles();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'inherit',
        alignSelf: 'stretch',
        animation: 'bubbleSlideUp 220ms cubic-bezier(0.25, 0.1, 0.25, 1) both',
      }}
    >
      {children}
    </div>
  );
}
