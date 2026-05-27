import { type Component, Show } from 'solid-js';
import type { BackgroundType } from '../types';

interface Props {
  type: BackgroundType;
}

export const Background: Component<Props> = (props) => {
  return (
    <div
      class="background-layer"
      style={{
        position: 'absolute',
        inset: 0,
        'z-index': 0,
        overflow: 'hidden',
      }}
    >
      <Show when={props.type === 'grid'}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            'background-image':
              'linear-gradient(rgba(0, 229, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, 0.03) 1px, transparent 1px)',
            'background-size': '40px 40px',
          }}
        />
      </Show>

      <Show when={props.type === 'gradient'}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(0, 229, 255, 0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(224, 64, 251, 0.05) 0%, transparent 50%)',
          }}
        />
      </Show>

      <Show when={props.type === 'stars'}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            'background-image': Array.from({ length: 100 }, () => {
              const x = Math.random() * 100;
              const y = Math.random() * 100;
              const s = Math.random() * 1.5 + 0.5;
              const o = Math.random() * 0.3 + 0.05;
              return `${x}% ${y}% 0 ${s}px rgba(0, 229, 255, ${o})`;
            }).join(', '),
            'box-shadow': Array.from({ length: 100 }, () => {
              const x = Math.random() * 100;
              const y = Math.random() * 100;
              const s = Math.random() * 1.5 + 0.5;
              const o = Math.random() * 0.3 + 0.05;
              return `${x}% ${y}% 0 ${s}px rgba(0, 229, 255, ${o})`;
            }).join(', '),
          }}
        />
      </Show>
    </div>
  );
};
