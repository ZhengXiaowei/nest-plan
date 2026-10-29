import {useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Banner} from '@astryxdesign/core/Banner';
import {useAiSettings, isAiConfigured} from '../ai/settings';
import {complete} from '../ai/client';
import {usePlanStore} from '../../store/planStore';
import {floorBudget, roomArea} from '../../model/geometry';
import type {Plan} from '../../model/types';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

/** 给模型的户型摘要：房间、面积、家具（不含图片） */
function planContext(plan: Plan) {
  const rooms = plan.rooms.map((r) => `${r.name} ${roomArea(r).toFixed(1)}㎡`).join('、');
  const furniture = plan.furniture.map((f) => `${f.name}(${f.w}×${f.d}mm @${Math.round(f.cx)},${Math.round(f.cy)})`).join('；');
  return `户型「${plan.name}」，层高 ${plan.wallHeight}mm。房间：${rooms}。家具：${furniture}。地面预算约 ¥${Math.round(floorBudget(plan).total)}。坐标单位 mm。`;
}

/**
 * AI 助手（第一版）：单轮问答，把当前户型摘要带给模型。
 * 后续会升级成能直接改方案的智能体（摆家具、检查通道宽度、出预算）。
 */
export default function AssistantTab() {
  const settings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  if (!isAiConfigured(settings)) {
    return (
      <>
        <Banner status="info" title="还没连接 AI" description="填上你自己的接口地址、密钥和模型后，就可以问我布局、动线和预算的问题。" />
        <Button label="连接 AI" variant="primary" onClick={() => openDialog(true)} />
      </>
    );
  }

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs((m) => [...m, {role: 'user', text: q}]);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const history = msgs.map((m) => `${m.role === 'user' ? '我' : '你'}：${m.text}`).join('\n');
      const text = await complete(settings, {
        system: `你是栖图的家装设计助手，回答简洁、具体，用中文。${planContext(usePlanStore.getState().plan)}`,
        text: history ? `${history}\n我：${q}` : q,
        maxTokens: 1500,
        signal: abortRef.current.signal,
      });
      setMsgs((m) => [...m, {role: 'assistant', text}]);
    } catch (e) {
      setMsgs((m) => [...m, {role: 'assistant', text: `出错了：${e instanceof Error ? e.message : String(e)}`}]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="np-chat">
        {msgs.length === 0 && <p className="np-hint">可以问：「客厅沙发和茶几间距够吗？」「子女房怎么放书桌更好？」</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`np-chat-msg np-chat-msg--${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>
      <TextArea label="问 AI" isLabelHidden placeholder="问问布局、动线、预算…" value={input} onChange={setInput} rows={3} />
      <Button label={busy ? '思考中' : '发送'} variant="primary" isLoading={busy} onClick={send} isDisabled={!input.trim()} />
    </>
  );
}
