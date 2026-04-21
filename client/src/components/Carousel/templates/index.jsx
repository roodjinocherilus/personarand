// All templates render at their export size. Visual scaling happens in the Studio frame.
// Each template accepts the same props: { slide, slideIndex, totalSlides }
// where slide = { headline, body, visual, style? }
//
// Styling (per-slide override, falls back to template defaults):
//   slide.style.bg           → string color OR { type: 'gradient', from, to, angle? }
//   slide.style.textColor    → headline color (falls back to template default)
//   slide.style.bodyColor    → body text color
//   slide.style.accentColor  → accent / page-counter color
//   slide.style.textScale    → multiplier for every font-size (e.g. 0.85, 1.0, 1.2)

const SIZE = 1080;

export const DEFAULT_BG = '#0a0a0a';
export const DEFAULT_ACCENT = '#0066ff';

// Curated palette presets — one click applies bg, textColor, accentColor together.
// Design choice: keep to ~8 looks that actually ship well. Too many choices = paralysis.
export const STYLE_PRESETS = [
  { key: 'midnight',   label: 'Midnight',       bg: '#0a0a0a',                             textColor: '#ffffff', bodyColor: '#c8c8c8', accentColor: '#0066ff' },
  { key: 'ivory',      label: 'Ivory',          bg: '#f5f2ed',                             textColor: '#1a1a1a', bodyColor: '#4a4a4a', accentColor: '#0052cc' },
  { key: 'ocean',      label: 'Ocean gradient', bg: { type: 'gradient', from: '#0b1a3a', to: '#1f4a7a', angle: 145 }, textColor: '#ffffff', bodyColor: '#cfe0f5', accentColor: '#67d1ff' },
  { key: 'sunset',     label: 'Sunset gradient',bg: { type: 'gradient', from: '#3b0a2a', to: '#d8502c', angle: 145 }, textColor: '#fff8f0', bodyColor: '#ffd7b8', accentColor: '#ffce63' },
  { key: 'forest',     label: 'Forest',         bg: '#0d1f15',                             textColor: '#e8f5e8', bodyColor: '#9fc7a8', accentColor: '#4bc97e' },
  { key: 'amber',      label: 'Amber mono',     bg: '#1a0d00',                             textColor: '#ffc26e', bodyColor: '#e8a043', accentColor: '#ff8800' },
  { key: 'haitian',    label: 'Haitian',        bg: { type: 'gradient', from: '#00209f', to: '#d21034', angle: 180 }, textColor: '#ffffff', bodyColor: '#f0e8d8', accentColor: '#fff1a8' },
  { key: 'paper',      label: 'Paper',          bg: '#fafaf5',                             textColor: '#1a1a1a', bodyColor: '#555555', accentColor: '#d24d28' },
];

// Shape the background descriptor into a CSS `background` value.
export function cssBackground(bg) {
  if (!bg) return DEFAULT_BG;
  if (typeof bg === 'string') return bg;
  if (bg.type === 'gradient') {
    const angle = bg.angle ?? 135;
    const from = bg.from || '#0a0a0a';
    const to = bg.to || '#1f1f1f';
    return `linear-gradient(${angle}deg, ${from}, ${to})`;
  }
  return DEFAULT_BG;
}

// Resolve style values with defaults. Each template calls this once and uses the result.
function resolveStyle(slide, defaults = {}) {
  const s = slide?.style || {};
  return {
    bg: cssBackground(s.bg ?? defaults.bg ?? DEFAULT_BG),
    textColor: s.textColor ?? defaults.textColor ?? '#ffffff',
    bodyColor: s.bodyColor ?? defaults.bodyColor ?? '#c8c8c8',
    accentColor: s.accentColor ?? defaults.accentColor ?? DEFAULT_ACCENT,
    textScale: typeof s.textScale === 'number' ? s.textScale : 1,
  };
}

// Scale a px number and return a string with "px" suffix.
function px(base, scale) {
  return `${Math.round(base * scale)}px`;
}

/**
 * Rich-body parser. Lets the user control per-line sizing with simple
 * markdown-style syntax inside a plain textarea:
 *
 *   # Huge line            (2.0x body base)
 *   ## Larger line         (1.5x)
 *   ### Slightly larger    (1.2x)
 *   Plain line             (1.0x — default)
 *   #### Smaller           (0.85x)
 *   ##### Even smaller     (0.7x)
 *
 * Blank line in the source = paragraph break (visual spacing).
 * Lines within a block keep their line breaks (whitespace: pre-wrap).
 * A line that is exactly "---" renders as a divider.
 *
 * This gives the user real typographic control without leaving the
 * textarea or learning a complex editor.
 */
const HEADING_SCALES = { 1: 2.0, 2: 1.5, 3: 1.2, 4: 0.85, 5: 0.7 };
const HEADING_WEIGHTS = { 1: 700, 2: 700, 3: 600, 4: 500, 5: 500 };

export function parseRichBody(body) {
  if (!body) return [];
  // Split on blank lines (1+ blank separator = paragraph break).
  const segments = body.split(/\n\s*\n+/);
  return segments
    .map((seg) => seg.replace(/^\n+|\n+$/g, ''))
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      if (seg.trim() === '---') return { kind: 'divider' };
      const m = seg.match(/^(#{1,5})\s+([\s\S]*)/);
      if (m) {
        const level = m[1].length;
        return {
          kind: 'heading',
          level,
          text: m[2],
          scale: HEADING_SCALES[level],
          weight: HEADING_WEIGHTS[level],
        };
      }
      return { kind: 'paragraph', text: seg };
    });
}

/**
 * Render a parsed rich-body block list. Caller supplies the base font size
 * for plain paragraphs; headings scale from that base. Each block is its
 * own div with gap-based spacing between them (paragraph spacing).
 */
function RichBody({ body, baseSize, scale, color, accentColor, maxWidth }) {
  const blocks = parseRichBody(body);
  if (blocks.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      gap: px(baseSize * 0.6, scale),
      maxWidth: maxWidth || 'none',
    }}>
      {blocks.map((b, i) => {
        if (b.kind === 'divider') {
          return (
            <div
              key={i}
              style={{
                height: '3px',
                background: accentColor,
                opacity: 0.5,
                maxWidth: '120px',
                marginTop: px(baseSize * 0.3, scale),
                marginBottom: px(baseSize * 0.3, scale),
              }}
            />
          );
        }
        const blockScale = (b.scale || 1) * scale;
        return (
          <div
            key={i}
            style={{
              fontSize: px(baseSize, blockScale),
              lineHeight: b.kind === 'heading' ? 1.15 : 1.45,
              fontWeight: b.weight || 400,
              color,
              whiteSpace: 'pre-wrap',
              letterSpacing: b.kind === 'heading' ? '-0.01em' : 'normal',
            }}
          >
            {b.text}
          </div>
        );
      })}
    </div>
  );
}

// Headline wrapper — respects newlines the user types (so they can break
// their headline into visual lines) without needing the markdown syntax.
function Headline({ text, style: headStyle }) {
  return (
    <div style={{ ...headStyle, whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}

function Frame({ children, bg, slide }) {
  return (
    <div
      style={{
        width: `${SIZE}px`,
        height: `${SIZE}px`,
        background: bg,
        color: slide?.style?.textColor ?? '#e0e0e0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        boxSizing: 'border-box',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

function PageCounter({ slideIndex, totalSlides, color, scale }) {
  return (
    <div style={{
      position: 'absolute', bottom: '40px', right: '60px',
      fontSize: px(22, scale), fontWeight: 500, color,
      fontVariantNumeric: 'tabular-nums', letterSpacing: '0.08em',
    }}>
      {String(slideIndex + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')}
    </div>
  );
}

function Brand({ color, scale }) {
  // "Roodjino" is the hardcoded brand mark that appears on every slide's
  // footer. Syne 700 + all caps + tight tracking — reads as a confident
  // logotype on any template or background color. Tracking dialed back
  // from -0.035em to -0.01em because all-caps Syne collides at tighter
  // values; -0.01em keeps it confident without letter overlap.
  return (
    <div style={{
      position: 'absolute', bottom: '40px', left: '60px',
      fontFamily: '"Syne", -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: px(28, scale), fontWeight: 700,
      color, letterSpacing: '-0.01em', textTransform: 'uppercase',
    }}>
      Roodjino
    </div>
  );
}

function TextHeavy({ slide, slideIndex, totalSlides }) {
  const { headline, body } = slide;
  const s = resolveStyle(slide, { bg: '#0a0a0a', textColor: '#ffffff', bodyColor: '#c8c8c8', accentColor: DEFAULT_ACCENT });
  const isCover = slideIndex === 0;
  const isCTA = slideIndex === totalSlides - 1;
  return (
    <Frame bg={s.bg} slide={slide}>
      <div style={{
        padding: '100px 80px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flex: 1, gap: '40px',
      }}>
        <Headline
          text={headline || (isCover ? '(Cover headline)' : '(headline)')}
          style={{
            fontSize: px(isCover ? 100 : 72, s.textScale),
            fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em',
            color: s.textColor,
          }}
        />
        {!isCover && body && (
          <RichBody
            body={body}
            baseSize={38}
            scale={s.textScale}
            color={s.bodyColor}
            accentColor={s.accentColor}
          />
        )}
        {isCTA && body && (
          <div style={{
            marginTop: '40px', fontSize: px(28, s.textScale), fontWeight: 600,
            color: s.accentColor, letterSpacing: '0.02em',
          }}>
            →
          </div>
        )}
      </div>
      <Brand color={`${s.textColor}cc`} scale={s.textScale} />
      {!isCover && <PageCounter slideIndex={slideIndex} totalSlides={totalSlides} color={`${s.textColor}80`} scale={s.textScale} />}
    </Frame>
  );
}

function QuoteMinimal({ slide, slideIndex, totalSlides }) {
  const { headline, body } = slide;
  const s = resolveStyle(slide, { bg: '#0a0a0a', textColor: '#ffffff', bodyColor: '#999999', accentColor: DEFAULT_ACCENT });
  return (
    <Frame bg={s.bg} slide={slide}>
      <div style={{
        padding: '120px 100px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flex: 1, textAlign: 'center', alignItems: 'center',
      }}>
        <div style={{
          fontSize: px(20, s.textScale), color: s.accentColor, fontWeight: 600,
          letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '60px',
        }}>
          {slideIndex === 0 ? 'A thesis' : slideIndex === totalSlides - 1 ? 'Last slide' : `Slide ${String(slideIndex + 1).padStart(2, '0')}`}
        </div>
        <Headline
          text={headline || '(one strong line)'}
          style={{
            fontSize: px(84, s.textScale), fontWeight: 700, lineHeight: 1.1,
            letterSpacing: '-0.02em', color: s.textColor, maxWidth: '880px',
          }}
        />
        {body && (
          <div style={{ marginTop: '48px', width: '100%', display: 'flex', justifyContent: 'center' }}>
            <RichBody
              body={body}
              baseSize={32}
              scale={s.textScale}
              color={s.bodyColor}
              accentColor={s.accentColor}
              maxWidth="780px"
            />
          </div>
        )}
      </div>
      <Brand color={`${s.textColor}cc`} scale={s.textScale} />
      {slideIndex > 0 && <PageCounter slideIndex={slideIndex} totalSlides={totalSlides} color={`${s.textColor}80`} scale={s.textScale} />}
    </Frame>
  );
}

function DataViz({ slide, slideIndex, totalSlides }) {
  const { headline, body } = slide;
  const s = resolveStyle(slide, { bg: '#0a0a0a', textColor: '#ffffff', bodyColor: '#c8c8c8', accentColor: DEFAULT_ACCENT });
  const firstBodyLine = (body || '').split('\n')[0] || '';
  // Everything after the first line (separated by a blank line) is "supporting" — rich body.
  const restLines = (body || '').split('\n').slice(1).join('\n').replace(/^\s+/, '');
  return (
    <Frame bg={s.bg} slide={slide}>
      <div style={{
        padding: '100px 80px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flex: 1, gap: '50px',
      }}>
        <Headline
          text={headline || '(headline)'}
          style={{
            fontSize: px(32, s.textScale), color: s.accentColor, fontWeight: 600,
            letterSpacing: '0.15em', textTransform: 'uppercase',
          }}
        />
        <div style={{
          fontSize: px(220, s.textScale), fontWeight: 800, lineHeight: 0.95,
          letterSpacing: '-0.04em', color: s.textColor,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'pre-wrap',
        }}>
          {firstBodyLine || '—'}
        </div>
        {restLines && (
          <RichBody
            body={restLines}
            baseSize={36}
            scale={s.textScale}
            color={s.bodyColor}
            accentColor={s.accentColor}
          />
        )}
      </div>
      <Brand color={`${s.textColor}cc`} scale={s.textScale} />
      <PageCounter slideIndex={slideIndex} totalSlides={totalSlides} color={`${s.textColor}80`} scale={s.textScale} />
    </Frame>
  );
}

function FrameworkBreakdown({ slide, slideIndex, totalSlides }) {
  const { headline, body } = slide;
  const s = resolveStyle(slide, { bg: '#0a0a0a', textColor: '#ffffff', bodyColor: '#c8c8c8', accentColor: DEFAULT_ACCENT });
  return (
    <Frame bg={s.bg} slide={slide}>
      <div style={{
        padding: '100px 80px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flex: 1, gap: '36px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '24px' }}>
          <div style={{
            fontSize: px(180, s.textScale), fontWeight: 800, lineHeight: 0.9,
            color: s.accentColor, letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {String(slideIndex + 1).padStart(2, '0')}
          </div>
          <div style={{
            fontSize: px(26, s.textScale), color: `${s.textColor}66`, fontWeight: 500,
            letterSpacing: '0.15em', textTransform: 'uppercase',
            transform: 'translateY(-20px)',
          }}>
            Step {slideIndex + 1} of {totalSlides}
          </div>
        </div>
        <Headline
          text={headline || '(step name)'}
          style={{
            fontSize: px(72, s.textScale), fontWeight: 700, lineHeight: 1.1,
            letterSpacing: '-0.02em', color: s.textColor,
          }}
        />
        {body && (
          <RichBody
            body={body}
            baseSize={34}
            scale={s.textScale}
            color={s.bodyColor}
            accentColor={s.accentColor}
            maxWidth="880px"
          />
        )}
      </div>
      <Brand color={`${s.textColor}cc`} scale={s.textScale} />
    </Frame>
  );
}

export const TEMPLATES = {
  'text-heavy': { label: 'Text-Heavy Educational', component: TextHeavy, description: 'Frameworks, breakdowns, long-form argument' },
  'quote-minimal': { label: 'Quote-Driven Minimal', component: QuoteMinimal, description: 'Single punchy statement, centered' },
  'data-viz': { label: 'Data Visualization', component: DataViz, description: 'Large stat, small supporting text' },
  'framework': { label: 'Framework Breakdown', component: FrameworkBreakdown, description: 'Numbered step-by-step' },
};

export function SlideRenderer({ templateKey, slide, slideIndex, totalSlides }) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES['text-heavy'];
  const Component = tpl.component;
  return (
    <Component
      slide={slide}
      slideIndex={slideIndex}
      totalSlides={totalSlides}
    />
  );
}

export const EXPORT_SIZE = SIZE;
