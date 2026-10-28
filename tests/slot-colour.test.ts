import { expect, it } from 'vitest';
import { slotColour } from '../src/shared/slot-colour';

it('takes the colour from a spectator GSI key or a Linux draft slot', () => {
  expect(slotColour('radiant', { slot: undefined }, { key: 'team2.player0' })).toMatchObject({
    index: 0,
    name: 'Blue',
  });
  expect(slotColour('dire', { slot: undefined }, { key: 'team3.player7' })).toMatchObject({
    index: 7,
    name: 'Light Blue',
  });
  expect(slotColour('dire', { slot: 9 })).toMatchObject({ index: 9, name: 'Brown', hex: '#a46900' });
  expect(slotColour('radiant', { slot: 4 }, { key: 'linux.4' })?.name).toBe('Orange');
});

it('draws no frame without slot order or when the side disagrees', () => {
  expect(slotColour('radiant', { slot: undefined }, { key: 'self' })).toBeUndefined();
  expect(slotColour('radiant', { slot: undefined })).toBeUndefined();
  expect(slotColour('radiant', { slot: 6 })).toBeUndefined();
  expect(slotColour('dire', { slot: undefined }, { key: 'team3.player2' })).toBeUndefined();
  expect(slotColour('dire', { slot: 12 })).toBeUndefined();
});
