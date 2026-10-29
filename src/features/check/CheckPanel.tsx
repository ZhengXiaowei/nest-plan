import {useEffect, useRef, useState} from 'react';
import {RULES, type Issue} from '../../model/checkup';
import {usePlanStore} from '../../store/planStore';
import {planView, useDesignUi} from '../design/designUi';
import {IconCheck} from '../../lib/icons';
import {useCheckup} from './checkStore';
import './check.css';

/** 分数从上次的值滚到新值 */
function useCountUp(target: number | null): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === null) return;
    const start = from.current ?? 0;
    from.current = target;
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 600);
      setShown(Math.round(start + (target - start) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function grade(score: number): {label: string; tone: string} {
  if (score >= 90) return {label: '住着顺手', tone: 'good'};
  if (score >= 70) return {label: '小地方要调', tone: 'mid'};
  return {label: '有几处别扭', tone: 'low'};
}

function ScoreRing({score}: {score: number}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const g = grade(score);
  return (
    <svg className={`chk-ring is-${g.tone}`} viewBox="0 0 84 84" role="img" aria-label={`体检 ${score} 分，${g.label}`}>
      <circle cx={42} cy={42} r={r} className="chk-ring-track" />
      <circle cx={42} cy={42} r={r} className="chk-ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      <text x={42} y={48}>{score}</text>
    </svg>
  );
}

export default function CheckPanel() {
  const {result, busy} = useCheckup();
  const focus = useDesignUi((s) => s.checkFocus);
  const shown = useCountUp(result?.score ?? null);
  const view = useDesignUi((s) => s.view);

  // 离开页签时取消高亮
  useEffect(() => () => useDesignUi.getState().setCheckFocus(null), []);

  const pick = (issue: Issue) => {
    const ui = useDesignUi.getState();
    if (ui.checkFocus === issue.id) {
      ui.setCheckFocus(null);
      return;
    }
    ui.setCheckFocus(issue.id);
    if (view !== '2d') ui.setView('2d');
    // 选中涉及的第一件家具，属性页可以直接改
    const fid = issue.furniture[0];
    if (fid) usePlanStore.getState().select({kind: 'furniture', id: fid});
    const xs = issue.shapes.flatMap((s) => (s.kind === 'poly' ? s.pts.map((p) => p[0]) : [s.c[0] - s.r, s.c[0] + s.r]));
    const ys = issue.shapes.flatMap((s) => (s.kind === 'poly' ? s.pts.map((p) => p[1]) : [s.c[1] - s.r, s.c[1] + s.r]));
    const span = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 2000;
    // 等切回平面图后再移
    requestAnimationFrame(() => planView.focus(issue.at, Math.max(2500, span)));
  };

  if (!result || shown === null) return <div className="np-loading" style={{height: 160}}>体检中…</div>;
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warns = result.issues.length - errors;
  const g = grade(result.score);

  return (
    <div className="chk-panel" aria-busy={busy}>
      <div className="chk-head">
        <ScoreRing score={shown} />
        <div>
          <strong className={`chk-grade is-${g.tone}`}>{g.label}</strong>
          <p className="np-hint" style={{margin: '2px 0 0'}}>
            {result.issues.length ? `${errors ? `${errors} 处要改` : ''}${errors && warns ? '，' : ''}${warns ? `${warns} 处建议调` : ''}` : '没发现别扭的地方'}
            {busy && <span className="chk-busy">复查中…</span>}
          </p>
        </div>
      </div>

      {result.issues.length > 0 && (
        <ol className="chk-list">
          {result.issues.map((issue, i) => (
            <li key={issue.id}>
              <button
                type="button"
                className={`chk-item is-${issue.severity}`}
                aria-pressed={focus === issue.id}
                onClick={() => pick(issue)}
              >
                <span className="chk-num">{i + 1}</span>
                <span className="chk-text">
                  <b>{issue.title}</b>
                  {focus === issue.id && <small>{issue.detail}</small>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {result.passed.length > 0 && (
        <section>
          <h3 className="np-panel-title">通过的项目</h3>
          <ul className="chk-passed">
            {result.passed.map((r) => (
              <li key={r}>
                <IconCheck />
                {RULES[r]}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="np-hint chk-note">
        按常用的人体尺度经验检查：床边、柜门前、开门扫过的地方、从入户门到各房间的通道。尺寸是设计经验值，不是强制规范；餐椅这类能推进桌下的家具不算挡路。
      </p>
    </div>
  );
}
