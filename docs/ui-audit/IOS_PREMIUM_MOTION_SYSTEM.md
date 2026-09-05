# iOS premium motion system

Written after the token/primitives pass. Physical iPhone 17 PRO Emiliano was
unavailable. Do not write `INTELIADS MOTION SYSTEM: PASS` from this file.

## Tokens

| Token | ms | Purpose |
| --- | ---: | --- |
| pressFeedback | 100 | tactile press |
| fastState | 140 | small state |
| contentChange | 200 | verified value / first reveal |
| segmentTransition | 200 | Today↔7D content |
| sheetTransition | 280 | sheets (native owns most of this) |
| pagerTransition | 220 | reserved; no Home pager yet |
| updateEmphasis | 400 | reserved; unused (no surface flash) |

Press scale: **0.985**. Ease-out bezier `0.23, 1, 0.32, 1`.
Properties: opacity + transform only.

## Reduce Motion

Press becomes an instant 0.985 hold.
Horizon and first reveal skip translation.
Value swap is instant.
Segment haptic is skipped.
Opacity-only remains allowed.
