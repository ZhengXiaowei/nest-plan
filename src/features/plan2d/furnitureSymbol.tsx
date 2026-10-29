import type {ReactNode} from 'react';

/**
 * 家具 2D 符号：以家具中心为原点、局部坐标（mm），宽 w 沿 x、深 d 沿 y，
 * 「靠背 / 床头」在 -y 一侧。只画几类常见家具的细节，其余用圆角矩形。
 */
export function furnitureSymbol(type: string, w: number, d: number, color: string): ReactNode {
  const x = -w / 2;
  const y = -d / 2;
  const base = <rect x={x} y={y} width={w} height={d} rx={Math.min(w, d) * 0.06} fill={color} className="fp-furn-body" />;
  switch (type) {
    case 'bed': {
      const pw = w > 1300 ? w / 2 - 80 : w - 160;
      return (
        <>
          {base}
          <rect x={x} y={y} width={w} height={d * 0.08} fill="#00000014" />
          {w > 1300 ? (
            <>
              <rect x={x + 60} y={y + d * 0.11} width={pw} height={d * 0.16} rx={60} className="fp-furn-detail" />
              <rect x={20} y={y + d * 0.11} width={pw} height={d * 0.16} rx={60} className="fp-furn-detail" />
            </>
          ) : (
            <rect x={x + 80} y={y + d * 0.11} width={pw} height={d * 0.16} rx={60} className="fp-furn-detail" />
          )}
          <line x1={x} y1={y + d * 0.36} x2={x + w} y2={y + d * 0.36} className="fp-furn-line" />
        </>
      );
    }
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(180, w * 0.12);
      const back = Math.min(200, d * 0.24);
      return (
        <>
          {base}
          <rect x={x} y={y} width={w} height={back} rx={60} fill="#00000014" />
          <rect x={x} y={y} width={arm} height={d} rx={60} fill="#00000010" />
          <rect x={x + w - arm} y={y} width={arm} height={d} rx={60} fill="#00000010" />
        </>
      );
    }
    case 'toilet':
      return (
        <>
          <rect x={x} y={y} width={w} height={d * 0.28} rx={40} fill={color} className="fp-furn-body" />
          <ellipse cx={0} cy={y + d * 0.62} rx={w * 0.45} ry={d * 0.36} fill={color} className="fp-furn-body" />
        </>
      );
    case 'roundtable':
    case 'plant':
    case 'floorlamp':
    case 'beanbag':
      return <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} fill={color} className="fp-furn-body" />;
    case 'rug':
      return <rect x={x} y={y} width={w} height={d} rx={40} fill={color} opacity={0.55} className="fp-furn-rug" />;
    case 'wardrobe':
    case 'bookshelf':
    case 'cabinet':
    case 'shoecab':
      return (
        <>
          {base}
          <line x1={x} y1={y} x2={x + w} y2={y + d} className="fp-furn-line" />
          <line x1={x + w} y1={y} x2={x} y2={y + d} className="fp-furn-line" />
        </>
      );
    case 'table':
    case 'desk':
    case 'coffeetable':
      return (
        <>
          {base}
          <rect x={x + 40} y={y + 40} width={Math.max(0, w - 80)} height={Math.max(0, d - 80)} rx={30} className="fp-furn-detail" />
        </>
      );
    default:
      return base;
  }
}
