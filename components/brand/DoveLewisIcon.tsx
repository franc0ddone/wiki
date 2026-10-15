import React, { useId } from 'react';

// Official DoveLewis Brand Color Palette (Pages 23-24)
export const DOVE_LEWIS_COLORS = {
  // Primary Greens
  'dove-green': '#AFBE23',
  'pale-green': '#DCE168',
  'light-green': '#CDD755',
  'medium-green': '#829600',
  'dark-green': '#5F6E00',
  'darker-green': '#373E1E',

  // Primary Blues
  'dove-blue': '#56A0D3',
  'light-blue': '#68C1FF',
  'dark-blue': '#0A2240',

  // Neutrals
  'dove-black': '#20241E',
  'gray-1': '#4E524A',
  'gray-2': '#62665C',
  'gray-3': '#7C7E74',
  'gray-4': '#8E9288',
  'gray-5': '#A6AAA0',
  'gray-6': '#B8BAB6',
  'bg-gray': '#F4F5F4',
  'white': '#FFFFFF',

  // Secondary Colors
  'dove-yellow': '#FFD42F',
  'dove-orange': '#E87200',
  'light-orange': '#F7A71A',
  'dark-orange': '#C04A00',
  'red': '#E23E2F',
} as const;

export type DoveLewisColor = keyof typeof DOVE_LEWIS_COLORS;

export type DoveLewisIconName =
  // Original Set
  | 'stethoscope'
  | 'medical-cross'
  | 'paw-heart'
  | 'sketch-cat'
  | 'borders-set'
  // Medical Departments & Specialties
  | 'cardiology'
  | 'radiology'
  | 'neurology'
  | 'surgery-recovery'
  | 'syringe'
  | 'thermometer'
  | 'otology-dermatology'
  // Specialty Programs
  | 'blood-bank'
  | 'stray-lost'
  | 'pactt-therapy'
  | 'pet-loss-hospice'
  | 'cupping-hands-heart'
  // Animals, Exotics & Wildlife
  | 'happy-dog'
  | 'rabbit-exotics'
  | 'wildlife-bird'
  | 'reptile-turtle'
  // App Empty States & UI
  | 'empty-bowl'
  | 'dog-bone'
  | 'medical-chart'
  | 'calendar-paw'
  | 'emergency-phone'
  | 'hospital-location'
  | 'pet-carrier'
  // Frames & Dividers
  | 'border-sketch-frame'
  | 'border-dashed'
  | 'border-paw-trail';

export interface DoveLewisIconProps extends React.SVGProps<SVGSVGElement> {
  /** The hand-drawn icon or border to render */
  name: DoveLewisIconName;
  /** Official DoveLewis brand color token or custom CSS color string */
  color?: DoveLewisColor | (string & {});
  /** Size in pixels or CSS units (applies to both width & height for square icons) */
  size?: number | string;
  /** Toggle the SVG freehand roughness filter (defaults to true per Page 25 guidelines) */
  roughness?: boolean;
  /** Accessible label for screen readers (if omitted, icon is treated as decorative aria-hidden) */
  title?: string;
}

const VIEWBOX_MAP: Partial<Record<DoveLewisIconName, string>> = {
  'borders-set': '0 0 400 120',
  'border-sketch-frame': '0 0 400 260',
  'border-dashed': '0 0 400 24',
  'border-paw-trail': '0 0 500 80',
};

export const DoveLewisIcon: React.FC<DoveLewisIconProps> = ({
  name,
  color = 'dove-black',
  size = 64,
  roughness = true,
  title,
  width,
  height,
  style,
  ...rest
}) => {
  const uniqueId = useId();
  const filterId = `dl-rough-sketch-${uniqueId.replace(/:/g, '')}`;

  const resolvedColor =
    color in DOVE_LEWIS_COLORS
      ? DOVE_LEWIS_COLORS[color as DoveLewisColor]
      : color;

  const viewBox = VIEWBOX_MAP[name] || '0 0 200 200';
  const isWideElement = Boolean(VIEWBOX_MAP[name]);

  const renderPaths = () => {
    switch (name) {
      case 'stethoscope':
        return (
          <>
            <path d="M52 28 C44 26, 42 35, 50 37" />
            <path d="M108 28 C116 26, 118 35, 110 37" />
            <path d="M48 33 C38 68, 54 104, 80 106 C106 104, 122 68, 112 33" />
            <path d="M68 99 C76 112, 84 112, 92 99" />
            <path d="M80 106 C79 142, 62 176, 98 176 C134 176, 118 122, 146 116 C164 112, 168 132, 156 146" />
            <path d="M148 144 C134 146, 132 168, 148 172 C164 175, 168 152, 152 144 Z" />
            <circle cx="150" cy="158" r="5" />
          </>
        );

      case 'medical-cross':
        return (
          <path d="M82 36 C94 35, 106 37, 118 36 C119 52, 117 66, 118 82 C134 81, 148 83, 164 82 C165 94, 163 106, 164 118 C148 119, 134 117, 118 118 C119 134, 117 148, 118 164 C106 165, 94 163, 82 164 C81 148, 83 134, 82 118 C66 119, 52 117, 36 118 C35 106, 37 94, 36 82 C52 81, 66 83, 82 82 C81 66, 83 52, 82 36 Z" />
        );

      case 'paw-heart':
        return (
          <>
            <path d="M100 172 C92 165, 28 118, 30 68 C32 38, 66 30, 88 52 C95 59, 98 64, 100 67 C102 64, 105 59, 112 52 C134 30, 168 38, 170 68 C172 118, 108 165, 100 172 Z" />
            <path d="M84 126 C78 122, 78 110, 88 104 C96 98, 104 98, 112 104 C122 110, 122 122, 116 126 C108 130, 92 130, 84 126 Z" />
            <ellipse cx="74" cy="92" rx="6" ry="9" transform="rotate(-20 74 92)" />
            <ellipse cx="91" cy="83" rx="6" ry="9" transform="rotate(-6 91 83)" />
            <ellipse cx="109" cy="83" rx="6" ry="9" transform="rotate(6 109 83)" />
            <ellipse cx="126" cy="92" rx="6" ry="9" transform="rotate(20 126 92)" />
          </>
        );

      case 'sketch-cat':
        return (
          <>
            <path d="M32 162 C36 125, 44 95, 50 78 L38 34 L78 58 C92 54, 108 54, 122 58 L162 34 L150 78 C156 95, 164 125, 168 162" />
            <path d="M48 48 L56 72 L68 62" />
            <path d="M152 48 L144 72 L132 62" />
            <path d="M64 98 C72 96, 82 96, 88 100 C84 108, 70 108, 64 98 Z" />
            <circle cx="76" cy="101" r="2.5" fill="currentColor" />
            <path d="M112 100 C118 96, 128 96, 136 98 C130 108, 116 108, 112 100 Z" />
            <circle cx="124" cy="101" r="2.5" fill="currentColor" />
            <path d="M94 114 C90 110, 100 106, 100 112 C100 106, 110 110, 106 114 L100 121 Z" fill="currentColor" />
            <path d="M100 121 C100 130, 88 136, 80 130" />
            <path d="M100 121 C100 130, 112 136, 120 130" />
            <path d="M62 115 L36 112 M62 124 L34 126 M64 133 L40 140" />
            <path d="M138 115 L164 112 M138 124 L166 126 M136 133 L160 140" />
          </>
        );

      case 'borders-set':
        return (
          <>
            <path d="M20 25 Q 40 12, 60 25 T 100 25 T 140 25 T 180 25 T 220 25 T 260 25 T 300 25 T 340 25 T 380 25" />
            <path d="M20 65 L35 52 L50 66 L65 51 L80 65 L95 53 L110 66 L125 52 L140 65 L155 51 L170 66 L185 52 L200 65 L215 53 L230 66 L245 51 L260 65 L275 52 L290 66 L305 53 L320 65 L335 52 L350 66 L365 51 L380 65" />
            <path d="M20 100 L42 99 M58 101 L80 99 M96 100 L118 101 M134 99 L156 100 M172 101 L194 99 M210 100 L232 101 M248 99 L270 100 M286 101 L308 99 M324 100 L346 101 M362 99 L380 100" />
          </>
        );

      /*
       * The dashed row of `borders-set`, lifted out on its own and recentred in
       * a 400×24 band (the dashes ride `y≈12`, that box's midline) — the
       * bulletin board's divider between its two groups of notices.
       *
       * **Hand-drawn, not ruled.** The geometry itself is irregular: the six
       * dashes are 34–46 units long with gaps of 18–36 between them, each riding
       * a slightly different `y` (11.2–12.8) and a slightly different stroke
       * weight, so the row never reads as a CSS `border-dashed`. The caller adds
       * the shared freehand roughness filter on top for the sketch quality the
       * brand guide's hand-drawn elements carry.
       *
       * Full strength: the row carries **no** opacity of its own. It used to sit
       * at `0.7` here, which compounded with a wrapper's own utility and washed
       * the rule out (0.35 × 0.7 ≈ 0.25) — the divider is a crisp mark now, and
       * any softening belongs in one place only, the call site.
       *
       * `currentColor` is how every icon in this file takes its colour, so a
       * caller's `color` prop still resolves through the SVG's `style`.
       */
      case 'border-dashed':
        return (
          <g fill="none" stroke="currentColor" strokeLinecap="round">
            <path strokeWidth="3.1" d="M20 11.4 L64 11.4" />
            <path strokeWidth="2.8" d="M88 12.7 L122 12.7" />
            <path strokeWidth="3.2" d="M142 11.2 L188 11.2" />
            <path strokeWidth="2.9" d="M216 12.8 L248 12.8" />
            <path strokeWidth="3.1" d="M266 11.6 L306 11.6" />
            <path strokeWidth="3" d="M342 12.5 L380 12.5" />
          </g>
        );

      case 'cardiology':
        return (
          <>
            <path d="M100 170 C90 162, 26 116, 28 68 C30 38, 64 30, 88 52 C95 58, 98 63, 100 66 C102 63, 105 58, 112 52 C136 30, 170 38, 172 68 C174 116, 110 162, 100 170 Z" />
            <path d="M18 102 L64 102 L76 74 L92 134 L110 60 L124 116 L134 102 L182 102" />
          </>
        );

      case 'radiology':
        return (
          <>
            <path d="M36 28 C80 26, 120 29, 164 28 C166 75, 163 125, 164 172 C120 174, 80 171, 36 172 C34 125, 37 75, 36 28 Z" />
            <path d="M48 42 L152 42 M48 158 L152 158" strokeWidth="3.5" />
            <path d="M76 80 C66 72, 58 84, 68 92 C60 100, 68 112, 78 104 L118 122 C116 132, 128 140, 134 128 C144 134, 150 120, 138 114 C146 106, 134 94, 126 104 L86 86 C88 76, 80 72, 76 80 Z" />
          </>
        );

      case 'neurology':
        return (
          <>
            <path d="M96 46 C72 38, 48 52, 48 74 C34 82, 32 108, 46 118 C42 138, 62 156, 84 148 C92 146, 96 138, 96 128 Z" />
            <path d="M64 76 C76 78, 80 90, 72 98 M58 116 C70 112, 82 118, 84 128" />
            <path d="M104 46 C128 38, 152 52, 152 74 C166 82, 168 108, 154 118 C158 138, 138 156, 116 148 C108 146, 104 138, 104 128 Z" />
            <path d="M136 76 C124 78, 120 90, 128 98 M142 116 C130 112, 118 118, 116 128" />
            <path d="M94 148 L92 172 M106 148 L108 172" />
            <path d="M100 20 L100 32 M136 26 L128 36 M64 26 L72 36" />
          </>
        );

      case 'surgery-recovery':
        return (
          <>
            <ellipse cx="100" cy="88" rx="72" ry="48" />
            <path d="M28 88 L68 154 C84 166, 116 166, 132 154 L172 88" />
            <path d="M72 82 C72 60, 128 60, 128 82 C130 104, 118 122, 100 122 C82 122, 70 104, 72 82 Z" />
            <path d="M72 72 C54 74, 52 102, 66 106" />
            <path d="M128 72 C146 74, 148 102, 134 106" />
            <circle cx="88" cy="86" r="3" fill="currentColor" />
            <circle cx="112" cy="86" r="3" fill="currentColor" />
            <ellipse cx="100" cy="100" rx="7" ry="5" fill="currentColor" />
          </>
        );

      case 'syringe':
        return (
          <>
            <path d="M138 26 L174 62 M156 44 L132 68" />
            <path d="M110 50 L150 90" />
            <path d="M118 58 L142 82 L82 142 L58 118 Z" />
            <path d="M106 70 L114 78 M92 84 L100 92 M78 98 L86 106" strokeWidth="4" />
            <path d="M64 124 L52 136 L64 148 L76 136" />
            <path d="M58 142 L26 174" />
            <path d="M22 182 C18 186, 22 192, 26 188 Z" />
          </>
        );

      case 'thermometer':
        return (
          <>
            <path d="M86 38 C86 24, 114 24, 114 38 L114 122 C128 130, 132 150, 120 164 C108 176, 92 176, 80 164 C68 150, 72 130, 86 122 Z" />
            <circle cx="100" cy="148" r="10" fill="currentColor" />
            <path d="M100 138 L100 68" strokeWidth="6" />
            <path d="M124 54 L136 54 M124 74 L132 74 M124 94 L136 94 M124 114 L132 114" strokeWidth="4" />
          </>
        );

      case 'otology-dermatology':
        return (
          <>
            <circle cx="88" cy="88" r="52" />
            <path d="M126 126 L172 172" strokeWidth="9" />
            <path d="M68 104 C72 88, 78 82, 82 74 C82 86, 84 96, 88 104 C92 90, 98 82, 104 76 C102 88, 104 98, 108 104" />
            <path d="M74 60 L74 68 M70 64 L78 64" strokeWidth="4" />
          </>
        );

      case 'blood-bank':
        return (
          <>
            <path d="M100 24 C100 24, 42 96, 42 134 C42 166, 68 182, 100 182 C132 182, 158 166, 158 134 C158 96, 100 24, 100 24 Z" />
            <path d="M86 150 C80 146, 82 134, 90 128 C96 124, 104 124, 110 128 C118 134, 120 146, 114 150 C106 154, 94 154, 86 150 Z" />
            <circle cx="76" cy="118" r="5" />
            <circle cx="91" cy="108" r="5" />
            <circle cx="109" cy="108" r="5" />
            <circle cx="124" cy="118" r="5" />
          </>
        );

      case 'stray-lost':
        return (
          <>
            <ellipse cx="100" cy="68" rx="66" ry="26" />
            <path d="M34 68 C34 98, 166 98, 166 68" />
            <rect x="88" y="82" width="24" height="18" rx="3" />
            <circle cx="100" cy="108" r="8" />
            <path d="M100 174 C94 168, 62 144, 64 122 C66 108, 84 104, 96 116 L100 120 L104 116 C116 104, 134 108, 136 122 C138 144, 106 168, 100 174 Z" />
          </>
        );

      case 'pactt-therapy':
        return (
          <>
            <path d="M34 52 C78 62, 122 62, 166 52 L100 168 Z" />
            <path d="M34 52 C20 44, 16 58, 28 64 M166 52 C180 44, 184 58, 172 64" />
            <path d="M66 68 C88 74, 112 74, 134 68" strokeWidth="4" />
            <path d="M100 126 C96 122, 82 110, 84 98 C86 90, 96 90, 100 96 C104 90, 114 90, 116 98 C118 110, 104 122, 100 126 Z" />
          </>
        );

      case 'pet-loss-hospice':
        return (
          <>
            <path d="M100 26 C100 26, 80 54, 84 70 C86 80, 94 84, 100 84 C106 84, 114 80, 116 70 C120 54, 100 26, 100 26 Z" />
            <path d="M100 84 L100 94" />
            <path d="M64 56 L52 52 M136 56 L148 52 M68 36 L58 28 M132 36 L142 28" strokeWidth="4" />
            <path d="M72 94 L128 94 L128 172 L72 172 Z" />
            <path d="M72 108 C82 116, 90 104, 96 118 C102 106, 116 114, 128 106" />
            <path d="M52 172 L148 172" />
          </>
        );

      case 'cupping-hands-heart':
        return (
          <>
            <path d="M100 106 C94 100, 62 74, 64 52 C66 36, 86 34, 96 46 L100 50 L104 46 C114 34, 134 36, 136 52 C138 74, 106 100, 100 106 Z" />
            <path d="M26 104 C24 134, 48 162, 88 168 L94 152 C70 146, 56 130, 52 108 C48 96, 30 94, 26 104 Z" />
            <path d="M174 104 C176 134, 152 162, 112 168 L106 152 C130 146, 144 130, 148 108 C152 96, 170 94, 174 104 Z" />
          </>
        );

      case 'happy-dog':
        return (
          <>
            <path d="M58 58 C82 44, 118 44, 142 58" />
            <path d="M58 58 C34 62, 22 102, 36 128 C44 138, 56 128, 58 108" />
            <path d="M142 58 C166 62, 178 102, 164 128 C156 138, 144 128, 142 108" />
            <path d="M56 96 C54 134, 72 158, 100 158 C128 158, 146 134, 144 96" />
            <path d="M72 76 L84 72 M128 76 L116 72" strokeWidth="4" />
            <circle cx="80" cy="90" r="4.5" fill="currentColor" />
            <circle cx="120" cy="90" r="4.5" fill="currentColor" />
            <ellipse cx="100" cy="112" rx="11" ry="8" fill="currentColor" />
            <path d="M100 120 C100 134, 82 138, 76 128 M100 120 C100 134, 118 138, 124 128" />
            <path d="M90 133 C90 152, 110 152, 110 133" />
          </>
        );

      case 'rabbit-exotics':
        return (
          <>
            <path d="M78 88 C64 56, 62 22, 76 20 C90 18, 96 52, 94 84" />
            <path d="M78 76 C72 54, 72 34, 78 32" strokeWidth="3.5" />
            <path d="M106 84 C112 52, 134 26, 146 34 C156 42, 138 72, 122 88" />
            <path d="M78 88 C52 96, 46 132, 68 152 C84 164, 116 164, 132 152 C154 132, 148 96, 122 88 C110 84, 90 84, 78 88 Z" />
            <circle cx="78" cy="116" r="4" fill="currentColor" />
            <circle cx="122" cy="116" r="4" fill="currentColor" />
            <path d="M92 128 L108 128 L100 136 Z" fill="currentColor" />
            <path d="M100 136 C96 144, 88 146, 84 142 M100 136 C104 144, 112 146, 116 142" />
          </>
        );

      case 'wildlife-bird':
        return (
          <>
            <path d="M148 64 C138 46, 114 48, 108 66 C92 78, 66 84, 38 78 L22 96 L48 102 C62 128, 98 142, 132 124 C152 112, 158 84, 148 64 Z" />
            <path d="M148 64 L172 70 L152 78" />
            <circle cx="132" cy="64" r="3.5" fill="currentColor" />
            <path d="M112 84 C94 96, 76 96, 62 88 C74 108, 102 114, 118 98" />
            <path d="M92 132 L86 164 L74 168 M92 132 L86 164 L96 168" />
            <path d="M114 130 L110 164 L98 168 M114 130 L110 164 L120 168" />
          </>
        );

      case 'reptile-turtle':
        return (
          <>
            <path d="M36 124 C36 68, 140 68, 140 124 Z" />
            <path d="M30 124 L146 124" strokeWidth="7" />
            <path d="M68 82 L88 104 L108 82 M56 124 L68 104 L108 104 L120 124" strokeWidth="4" />
            <path d="M140 112 C154 110, 164 92, 174 96 C182 100, 178 118, 162 122 L140 122" />
            <circle cx="166" cy="104" r="2.5" fill="currentColor" />
            <path d="M52 124 L46 148 L62 148 L66 124" />
            <path d="M114 124 L112 148 L128 148 L130 124" />
            <path d="M36 120 L20 126 L36 126" />
          </>
        );

      case 'empty-bowl':
        return (
          <>
            <ellipse cx="100" cy="86" rx="64" ry="20" />
            <path d="M54 90 C84 82, 116 82, 146 90" strokeWidth="3.5" />
            <path d="M36 86 L22 142 C22 162, 178 162, 178 142 L164 86" />
            <path d="M100 142 C96 138, 86 128, 88 120 C90 114, 96 114, 100 120 C104 114, 110 114, 112 120 C114 128, 104 138, 100 142 Z" />
          </>
        );

      case 'dog-bone':
        return (
          <path d="M54 68 C38 52, 20 72, 36 88 C20 104, 38 124, 54 108 L130 132 C126 152, 152 162, 160 142 C178 150, 188 124, 168 116 C178 98, 152 86, 142 104 L66 80 C70 62, 58 58, 54 68 Z" />
        );

      case 'medical-chart':
        return (
          <>
            <path d="M72 38 L44 38 L44 174 L156 174 L156 38 L128 38" />
            <path d="M72 30 L128 30 L128 48 L72 48 Z" />
            <path d="M90 30 C90 18, 110 18, 110 30" />
            <path d="M100 68 L100 96 M86 82 L114 82" strokeWidth="6" />
            <path d="M66 118 L134 118 M66 136 L134 136 M66 154 L110 154" strokeWidth="4.5" />
          </>
        );

      case 'calendar-paw':
        return (
          <>
            <path d="M34 48 L166 48 L166 168 L34 168 Z" />
            <path d="M34 78 L166 78" />
            <path d="M66 32 L66 58 M134 32 L134 58" strokeWidth="7" />
            <ellipse cx="100" cy="134" rx="16" ry="12" />
            <circle cx="78" cy="112" r="5" />
            <circle cx="93" cy="104" r="5" />
            <circle cx="107" cy="104" r="5" />
            <circle cx="122" cy="112" r="5" />
          </>
        );

      case 'emergency-phone':
        return (
          <>
            <path d="M46 38 C32 48, 30 74, 44 102 C60 134, 88 158, 122 168 C146 174, 166 162, 170 146 L142 124 C134 126, 126 134, 118 132 C98 124, 80 106, 72 86 C70 78, 78 70, 80 62 L58 34 Z" />
            <path d="M116 48 C134 48, 148 62, 148 80" />
            <path d="M116 28 C146 28, 168 50, 168 80" />
          </>
        );

      case 'hospital-location':
        return (
          <>
            <path d="M100 176 C100 176, 44 118, 44 76 C44 44, 68 24, 100 24 C132 24, 156 44, 156 76 C156 118, 100 176, 100 176 Z" />
            <path d="M100 54 L100 98 M78 76 L122 76" strokeWidth="7" />
          </>
        );

      case 'pet-carrier':
        return (
          <>
            <path d="M76 62 C76 42, 124 42, 124 62" />
            <path d="M36 62 L164 62 L174 156 L26 156 Z" />
            <path d="M22 110 L178 110" strokeWidth="4" />
            <rect x="68" y="78" width="64" height="62" rx="4" />
            <path d="M88 78 L88 140 M112 78 L112 140 M68 100 L132 100 M68 120 L132 120" strokeWidth="3.5" />
            <path d="M44 82 L56 82 M42 94 L56 94 M144 82 L156 82 M144 94 L158 94" strokeWidth="4" />
          </>
        );

      case 'border-sketch-frame':
        return (
          <>
            <path d="M16 18 C140 12, 260 22, 384 16 C388 95, 380 165, 384 242 C260 248, 140 238, 16 244 C12 165, 20 95, 16 18 Z" />
            <path
              d="M20 14 C145 20, 255 12, 380 20 C382 98, 388 162, 380 246 C255 240, 145 248, 20 240 C18 162, 12 98, 20 14 Z"
              strokeWidth="2.5"
              opacity="0.75"
            />
          </>
        );

      case 'border-paw-trail':
        return (
          <g fill="currentColor">
            <path d="M16 40 C70 36, 130 44, 184 40" fill="none" strokeWidth="4.5" />
            <g transform="translate(215, 44) rotate(15) scale(0.55)">
              <ellipse cx="0" cy="0" rx="12" ry="9" />
              <circle cx="-14" cy="-14" r="4" />
              <circle cx="-5" cy="-20" r="4" />
              <circle cx="5" cy="-20" r="4" />
              <circle cx="14" cy="-14" r="4" />
            </g>
            <g transform="translate(250, 32) rotate(-10) scale(0.55)">
              <ellipse cx="0" cy="0" rx="12" ry="9" />
              <circle cx="-14" cy="-14" r="4" />
              <circle cx="-5" cy="-20" r="4" />
              <circle cx="5" cy="-20" r="4" />
              <circle cx="14" cy="-14" r="4" />
            </g>
            <g transform="translate(285, 44) rotate(12) scale(0.55)">
              <ellipse cx="0" cy="0" rx="12" ry="9" />
              <circle cx="-14" cy="-14" r="4" />
              <circle cx="-5" cy="-20" r="4" />
              <circle cx="5" cy="-20" r="4" />
              <circle cx="14" cy="-14" r="4" />
            </g>
            <path d="M316 40 C370 44, 430 36, 484 40" fill="none" strokeWidth="4.5" />
          </g>
        );
    }
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width ?? (isWideElement ? '100%' : size)}
      height={height ?? (isWideElement ? 'auto' : size)}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={!title}
      style={{ color: resolvedColor, ...style }}
      {...rest}
    >
      {title && <title>{title}</title>}
      {roughness && (
        <defs>
          <filter id={filterId} x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.065"
              numOctaves={3}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={2.8}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      )}
      <g
        filter={roughness ? `url(#${filterId})` : undefined}
        stroke="currentColor"
        strokeWidth={isWideElement ? 4 : 5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {renderPaths()}
      </g>
    </svg>
  );
};

export default DoveLewisIcon;