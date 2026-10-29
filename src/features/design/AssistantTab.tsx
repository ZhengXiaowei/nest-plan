import {useEffect, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Banner} from '@astryxdesign/core/Banner';
import {useAiSettings, isAiConfigured} from '../ai/settings';
import {reapply, runAgent, type AgentStage, type AgentTurn} from '../ai/planAgent';
import {usePlanStore} from '../../store/planStore';
import type {Vec2} from '../../model/types';
import {planView, useDesignUi} from './designUi';
import './assistant.css';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  turn?: AgentTurn;
  /** 这次改动套用后的方案，用来判断还能不能直接撤销 */
  applied?: unknown;
  undone?: boolean;
}

const STAGE_TEXT: Record<AgentStage, string> = {
  thinking: '在看方案…',
  checking: '改好了，正在体检…',
  retrying: '改完多了新问题，再调一轮…',
};

const SUGGESTIONS = ['帮我把体检里的问题改掉', '小孩房床尾太挤，帮我调一下', '客厅加一个书架，放哪合适？'];

function ChangeCard({msg, onUndo}: {msg: Msg; onUndo: () => void}) {
  const t = msg.turn!;
  const latest = usePlanStore((s) => s.plan === msg.applied);
  const focus = (id: string, at: Vec2) => {
    const ui = useDesignUi.getState();
    if (ui.view !== '2d') ui.setView('2d');
    if (usePlanStore.getState().plan.furniture.some((f) => f.id === id)) usePlanStore.getState().select({kind: 'furniture', id});
    requestAnimationFrame(() => planView.focus(at, 3000));
  };
  const delta = t.after.score - t.before.score;
  return (
    <div className={`ai-change${msg.undone ? ' is-undone' : ''}`}>
      <div className="ai-change-head">
        <span>{msg.undone ? '已撤销' : `改了 ${t.changes.length} 处`}</span>
        <span className={`ai-score${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`}>
          体检 {t.before.score} → {t.after.score}
        </span>
      </div>
      <ul className="ai-change-list">
        {t.changes.map((c) => (
          <li key={c.op + c.id}>
            <button type="button" onClick={() => focus(c.id, c.at)} disabled={msg.undone}>
              {c.text}
            </button>
          </li>
        ))}
      </ul>
      {t.fixed.length > 0 && (
        <p className="ai-fixed">
          解决了 {t.fixed.length} 个问题：{t.fixed.slice(0, 3).map((i) => i.title).join('；')}
          {t.fixed.length > 3 && ' 等'}
        </p>
      )}
      {t.eased.length > 0 && (
        <p className="ai-fixed">
          缓解了 {t.eased.length} 个：{t.eased.slice(0, 3).map((i) => i.title).join('；')}
        </p>
      )}
      {t.added.length > 0 && (
        <p className="ai-added">
          新出现 {t.added.length} 个：{t.added.slice(0, 3).map((i) => i.title).join('；')}
        </p>
      )}
      {!msg.undone && (
        <div className="ai-change-actions">
          <Button label="撤销这次改动" size="sm" variant="secondary" onClick={onUndo} isDisabled={!latest} />
          <Button label="看体检" size="sm" variant="ghost" onClick={() => useDesignUi.getState().setPanel('check')} />
        </div>
      )}
      {!msg.undone && !latest && <small className="np-hint">之后又改过方案，用顶栏的撤销一步步退回去。</small>}
    </div>
  );
}

/**
 * AI 助手：能直接改家具布置。模型回一组改动，本地校验后作为一步套用（可撤销），
 * 改完自动体检，带出新问题时再让模型调一轮。
 */
export default function AssistantTab() {
  const settings = useAiSettings((s) => s.settings);
  const openDialog = useAiSettings((s) => s.openDialog);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [stage, setStage] = useState<AgentStage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const configured = isAiConfigured(settings);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }, [msgs, stage]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || stage) return;
    setInput('');
    const history = msgs
      .slice(-8)
      .map((m) => {
        const changed = m.turn?.changes.length ? `（改了：${m.turn.changes.map((c) => c.text).join('；')}${m.undone ? '，用户撤销了' : ''}）` : '';
        return `${m.role === 'user' ? '用户' : '助手'}：${m.text}${changed}`;
      })
      .join('\n');
    setMsgs((m) => [...m, {role: 'user', text: q}]);
    setStage('thinking');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const start = usePlanStore.getState().plan;
    try {
      const turn = await runAgent({settings, plan: start, history, ask: q, signal: ctrl.signal, onStage: setStage});
      if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
      let applied: unknown;
      if (turn.changes.length) {
        // 等模型的时候用户又改了方案：把同样的改动套到最新的方案上
        const store = usePlanStore.getState();
        const next = store.plan === start ? turn.plan : reapply(store.plan, turn.actions);
        store.commit(() => next);
        applied = usePlanStore.getState().plan;
      }
      setMsgs((m) => [...m, {role: 'assistant', text: turn.reply, turn: turn.changes.length ? turn : undefined, applied}]);
    } catch (e) {
      const text = ctrl.signal.aborted ? '好，停下了，方案没动。' : `出错了：${e instanceof Error ? e.message : String(e)}`;
      setMsgs((m) => [...m, {role: 'assistant', text}]);
    } finally {
      setStage(null);
    }
  };

  // 从体检页点「交给 AI 改」过来：直接发出去
  const draft = useDesignUi((s) => s.aiDraft);
  useEffect(() => {
    if (!draft || !configured) return;
    useDesignUi.getState().setAiDraft(null);
    void send(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, configured]);

  if (!configured) {
    return (
      <>
        <Banner
          status="info"
          title="还没连接 AI"
          description="填上你自己的接口地址、密钥和模型后，我就能直接帮你挪家具、解决体检里的问题。方案只发给你填的接口。"
        />
        <Button label="连接 AI" variant="primary" onClick={() => openDialog(true)} />
      </>
    );
  }

  const undo = (i: number) => {
    usePlanStore.getState().undo();
    setMsgs((m) => m.map((x, j) => (j === i ? {...x, undone: true} : x)));
  };

  return (
    <>
      <div className="np-chat" ref={listRef} aria-live="polite">
        {msgs.length === 0 && (
          <div className="ai-intro">
            <p className="np-hint">我能直接改方案：挪家具、换方向、改尺寸、加减家具，改完会自动体检。每次改动都能撤销。</p>
            <div className="ai-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`np-chat-msg np-chat-msg--${m.role}`}>
            {m.text}
            {m.turn && <ChangeCard msg={m} onUndo={() => undo(i)} />}
          </div>
        ))}
        {stage && <div className="np-chat-msg np-chat-msg--assistant ai-stage">{STAGE_TEXT[stage]}</div>}
      </div>
      <TextArea label="问 AI" isLabelHidden placeholder="比如：把子女房的床挪开一点，两边都能下床" value={input} onChange={setInput} rows={3} />
      {stage ? (
        <Button label="停下" variant="secondary" onClick={() => abortRef.current?.abort()} />
      ) : (
        <Button label="发送" variant="primary" onClick={() => void send()} isDisabled={!input.trim()} />
      )}
    </>
  );
}
