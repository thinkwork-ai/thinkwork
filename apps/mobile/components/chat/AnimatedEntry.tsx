import React from 'react';
import { View } from 'react-native';
import Reanimated, { FadeInDown } from 'react-native-reanimated';

const messageEntering = FadeInDown.springify().damping(28).stiffness(260);

interface AnimatedEntryProps {
  animate?: boolean;
  children: React.ReactNode;
}

export function AnimatedEntry({ animate, children }: AnimatedEntryProps) {
  if (!animate) return <View>{children}</View>;
  return (
    <Reanimated.View entering={messageEntering}>
      {children}
    </Reanimated.View>
  );
}
