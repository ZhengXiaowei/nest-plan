import {create} from 'zustand';

/**
 * 轻量提示条。Astryx 的 Toast 带完整的分层和手势系统（约 12 KB），
 * 这里只需要一句话的短提示，自己写一个放在首屏里更划算。
 */

type Tone = 'info' | 'error';
interface ToastItem {
  id: number;
  body: string;
  tone: Tone;
}

const useToasts = create<{items: ToastItem[]}>()(() => ({items: []}));
let seq = 0;

export function toast(body: string, tone: Tone = 'info', ms = 2200) {
  const id = ++seq;
  // 同一时间只留最新一条，连点时不堆叠
  useToasts.setState({items: [{id, body, tone}]});
  window.setTimeout(() => useToasts.setState((s) => ({items: s.items.filter((t) => t.id !== id)})), ms);
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="np-toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`np-toast np-toast--${t.tone}`}>
          {t.body}
        </div>
      ))}
    </div>
  );
}
