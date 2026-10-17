import Image from 'next/image';

export type LogoVariant = 'icon' | 'mark';

const MARK_SRC: Record<LogoVariant, string> = {
  // Padded tile for in-app display; the edge-to-edge favicon variant lives
  // in app/icon.svg (Next.js serves it as /icon) and is tab-size only.
  icon: '/scout-icon.svg',
  // Transparent background for dark surfaces: Privy modals, emails, footer.
  mark: '/scout-mark.svg',
};

interface LogoMarkProps {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}

/**
 * The Iris: your artwork, served as static files. The component only picks
 * the variant and size; all geometry lives in public/scout-*.svg.
 *
 * The new mark is three shapes (two cream arcs, one lime pupil), so unlike
 * the old 52KB path it stays crisp at any size. The padded tile gets rounded
 * corners, a hairline ring, and a soft shadow to sit on paper like an app
 * icon; the transparent mark is for dark surfaces and needs none of that.
 */
export function LogoMark({ size = 40, variant = 'icon', className }: LogoMarkProps) {
  const framed = variant === 'icon';
  return (
    <Image
      src={MARK_SRC[variant]}
      alt="Scout logo"
      width={size}
      height={size}
      className={`${framed ? 'rounded-[22%] shadow-[0_1px_2px_rgba(16,20,15,0.18)] ring-1 ring-linestrong' : ''}${className ? ` ${className}` : ''}`}
    />
  );
}

interface LogoLockupProps {
  /** 'light' = mono-dark mark for light surfaces; 'dark' = cream lockup for dark surfaces. */
  variant?: 'light' | 'dark';
  /** Rendered height in px; width follows the 1286:700 aspect. */
  height?: number;
  className?: string;
}

/**
 * Full lockup: the designer's own SVG (eye tile + SCOUT wordmark as vector
 * paths, not HTML text). Use on light surfaces (header, login); the dark
 * variant is for dark surfaces (footer is light too, so it stays 'light').
 */
export function LogoLockup({ variant = 'light', height = 30, className }: LogoLockupProps) {
  const width = Math.round((height * 1286) / 700);
  return (
    <Image
      src={variant === 'light' ? '/scout-lockup-light-mono.svg' : '/scout-lockup-dark.svg'}
      alt="Scout"
      width={width}
      height={height}
      className={className}
    />
  );
}
