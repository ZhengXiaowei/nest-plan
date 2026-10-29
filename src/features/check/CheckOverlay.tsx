import type {Shape} from '../../model/checkup';
import {useDesignUi} from '../design/designUi';
import {useCheckup} from './checkStore';

/** 平面图上的体检层：问题区域标红 / 橙，带编号，和右侧列表对应 */
export default function CheckOverlay() {
  const {result} = useCheckup();
  const focus = useDesignUi((s) => s.checkFocus);
  if (!result) return null;
  const shape = (s: Shape, k: number) =>
    s.kind === 'poly' ? <polygon key={k} points={s.pts.map((p) => p.join(',')).join(' ')} /> : <circle key={k} cx={s.c[0]} cy={s.c[1]} r={s.r} />;
  // 选中的那条画在最上面
  const order = result.issues.map((issue, i) => ({issue, n: i + 1})).sort((a, b) => Number(a.issue.id === focus) - Number(b.issue.id === focus));
  return (
    <g className={`chk-overlay${focus ? ' has-focus' : ''}`} aria-hidden>
      {order.map(({issue, n}) => (
        <g key={issue.id} className={`chk-issue is-${issue.severity}${issue.id === focus ? ' is-focus' : ''}`}>
          <g className="chk-shapes">{issue.shapes.map(shape)}</g>
          <g className="chk-pin" transform={`translate(${issue.at[0]} ${issue.at[1]})`}>
            <circle r={190} />
            <text dy={62}>{n}</text>
          </g>
        </g>
      ))}
    </g>
  );
}
