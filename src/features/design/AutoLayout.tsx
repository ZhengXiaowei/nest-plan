import {useEffect, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Switch} from '@astryxdesign/core/Switch';
import {Banner} from '@astryxdesign/core/Banner';
import type {Plan, Room} from '../../model/types';
import {furnitureInRoom, layoutRoomKind, withRoomFurniture, type LayoutRoomKind} from '../../model/autolayout';
import {usePlanStore} from '../../store/planStore';
import {isAiConfigured, useAiSettings} from '../ai/settings';
import {layoutRoom, type RoomLayoutResult} from '../ai/layout';
import {toast} from '../../lib/toast';
import './autolayout.css';

const PLACEHOLDER: Record<LayoutRoomKind, string> = {
  bedroom: '例如：两口人，要梳妆台，衣柜尽量大',
  living: '例如：要转角沙发和 65 寸电视，留一块玩耍的地方',
  dining: '例如：六人餐桌，靠墙放餐边柜',
  study: '例如：两张书桌，书架要多',
};

/**
 * 选中房间时属性面板里的「AI 布置」。按需加载，换房间时由父组件用 key 重建。
 * 布置结果一次写进方案（一步撤销）；面板上的「撤销」只在方案没再改动时一键回退。
 */
export default function AutoLayout({room}: {room: Room}) {
  const kind = layoutRoomKind(room.name);
  const settings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);
  const count = usePlanStore((s) => furnitureInRoom(s.plan, room.id).length);
  const [request, setRequest] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{result: RoomLayoutResult; applied: Plan} | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 离开这个房间时取消还没回来的请求，免得结果写进别的状态里
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!kind) {
    return (
      <div className="np-autolayout">
        <h3 className="np-panel-title">AI 布置</h3>
        <p className="np-hint">厨房、卫生间、阳台、过道和玄关暂不支持 AI 布置，可以从左侧家具库手动摆。</p>
      </div>
    );
  }

  const ready = isAiConfigured(settings);
  const keepExisting = keep && count > 0;

  const run = async () => {
    if (!ready) {
      openDialog(true);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const result = await layoutRoom(settings, usePlanStore.getState().plan, room.id, {request, keepExisting, signal: ctrl.signal});
      if (ctrl.signal.aborted) return;
      if (!result.furniture.length) {
        setError(['AI 给的家具一件都没放上：', ...result.skipped].join('\n'));
        return;
      }
      usePlanStore.getState().commit((p) => withRoomFurniture(p, room.id, result.furniture, keepExisting));
      setDone({result, applied: usePlanStore.getState().plan});
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const undo = () => {
    const store = usePlanStore.getState();
    if (done && store.plan === done.applied) {
      store.undo();
      // 撤销会清掉选中，选回这个房间，面板留在这里
      store.select({kind: 'room', id: room.id});
      setDone(null);
    } else {
      toast('布置之后方案又改过了，请用顶栏的撤销一步步退回');
    }
  };

  if (done) {
    const {result} = done;
    const n = result.furniture.length;
    const ok = !result.issues.length;
    return (
      <div className="np-autolayout">
        <h3 className="np-panel-title">AI 布置</h3>
        <Banner
          status={ok ? 'success' : 'warning'}
          title={ok ? `摆好了 ${n} 件家具` : `摆好了 ${n} 件家具，还有 ${result.issues.length} 个问题`}
          description={result.note || undefined}
        />
        {result.issues.length > 0 && (
          <div>
            <h4>还有这些问题</h4>
            <ul className="np-autolayout-list np-autolayout-list--warn">
              {result.issues.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
        {result.skipped.length > 0 && (
          <div>
            <h4>没放上的</h4>
            <ul className="np-autolayout-list">
              {result.skipped.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="np-hint">{result.rounds > 1 ? 'AI 按检查结果改过一次。' : ''}不满意可以撤销重来，也可以直接拖动家具微调。</p>
        <div className="np-row-actions">
          <Button label="保留" variant="primary" size="sm" onClick={() => setDone(null)} />
          <Button label="撤销" variant="ghost" size="sm" onClick={undo} />
        </div>
      </div>
    );
  }

  return (
    <div className="np-autolayout">
      <h3 className="np-panel-title">AI 布置</h3>
      <TextArea label="需求（可不填）" placeholder={PLACEHOLDER[kind]} value={request} onChange={setRequest} rows={2} isDisabled={busy} />
      {count > 0 && (
        <Switch
          label="保留房间里现有的家具"
          description={keep ? '新家具会避开它们' : `会先清掉这里的 ${count} 件家具，可以撤销`}
          value={keep}
          onChange={setKeep}
        />
      )}
      <div className="np-row-actions">
        <Button label={busy ? '布置中…' : 'AI 布置这个房间'} variant="primary" size="sm" isLoading={busy} isDisabled={busy} onClick={run} />
        {busy && <Button label="取消" variant="ghost" size="sm" onClick={() => abortRef.current?.abort()} />}
      </div>
      {!ready && <p className="np-hint">要先连接 AI（用你自己的接口和密钥），点按钮会打开设置。</p>}
      {error && <Banner status="error" title="没能布置" description={<span style={{whiteSpace: 'pre-line'}}>{error}</span>} />}
    </div>
  );
}
