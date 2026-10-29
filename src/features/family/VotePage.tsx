import {useEffect, useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {hashParams, navigate, replaceHash} from '../../lib/router';
import {toast} from '../../lib/toast';
import {uid} from '../../lib/id';
import {usePlanStore} from '../../store/planStore';
import {runCheckup} from '../../model/checkup';
import {roomArea} from '../../model/geometry';
import type {Plan, Vec2} from '../../model/types';
import {decodeData, encodeData, linkFor, parsePack, parseReply, readVoteLink, tally, type Candidate, type Pin, type Reply, type SharePack} from './share';
import {useFamily, type OwnedShare} from './familyStore';
import {PlanPreview, type PreviewPin} from './PlanPreview';
import './family.css';

const PIN_COLORS = ['#2747D6', '#D9480F', '#0F766E', '#9333EA', '#B45309', '#BE185D'];
const LETTERS = 'ABCDEFGH';

/** 方案的几个关键数：面积、体检分、家具数 */
function useStats(plan: Plan) {
  return useMemo(() => {
    const area = plan.rooms.filter((r) => r.counted !== false).reduce((s, r) => s + roomArea(r), 0);
    return {area, score: runCheckup(plan).score, furniture: plan.furniture.length};
  }, [plan]);
}

function Stats({plan}: {plan: Plan}) {
  const s = useStats(plan);
  return (
    <p className="fm-stats">
      <span>套内 {s.area.toFixed(1)} ㎡</span>
      <span>家具 {s.furniture} 件</span>
      <span className={s.score >= 90 ? 'is-good' : s.score >= 70 ? '' : 'is-low'}>体检 {s.score} 分</span>
    </p>
  );
}

/* ---------- 读链接 ---------- */

/** 打开带 ?d= 或 ?r= 的链接：读进本机，然后把参数从地址栏清掉 */
async function consumeLink(raw: string): Promise<void> {
  const link = readVoteLink(raw);
  if (!link) throw new Error('没认出链接，请复制完整的栖图链接');
  const data = await decodeData(link.data).catch(() => {
    throw new Error('链接不完整或已损坏，请让对方重新发一次');
  });
  const fam = useFamily.getState();
  if (link.kind === 'pack') {
    fam.openAsGuest(parsePack(data));
    return;
  }
  const reply = parseReply(data);
  await fam.load();
  const hit = useFamily.getState().importReply(reply);
  if (!hit) throw new Error('这条回复对应的方案不是从这台设备发出去的');
  toast(`收到${reply.author}的意见`);
  // 等结果渲染出来再滚过去
  setTimeout(() => document.querySelector(`[data-share="${CSS.escape(reply.share)}"]`)?.scrollIntoView({behavior: 'smooth', block: 'start'}), 120);
}

function useIncomingLink() {
  useEffect(() => {
    const read = () => {
      const p = hashParams();
      const d = p.get('d');
      const r = p.get('r');
      if (!d && !r) return;
      replaceHash('vote');
      consumeLink(d ? `?d=${d}` : `?r=${r}`).catch((e: Error) => toast(e.message, 'error', 4000));
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
}

/* ---------- 分享链接框 ---------- */

function LinkBox({link, fileName, hint}: {link: string; fileName: string; hint: string}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('链接已复制，发到微信里就行');
    } catch {
      toast('复制不了，长按链接手动复制', 'error');
    }
  };
  const share = async () => {
    try {
      await navigator.share({title: '栖图', text: hint, url: link});
    } catch {
      // 用户取消
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${hint}\n${link}\n`], {type: 'text/plain'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="fm-linkbox">
      <input readOnly value={link} aria-label="分享链接" onFocus={(e) => e.currentTarget.select()} />
      <div className="fm-row">
        <Button label="复制链接" variant="primary" size="sm" onClick={copy} />
        {'share' in navigator && <Button label="分享…" variant="secondary" size="sm" onClick={share} />}
        <Button label="存成文件" variant="ghost" size="sm" onClick={download} />
      </div>
      <small className="np-hint">方案整个装在链接里，不经过任何服务器；链接太长发不出去时，用文件发。</small>
    </div>
  );
}

/* ---------- 家人：看方案、投票、留言 ---------- */

function GuestView() {
  const g = useFamily((s) => s.guest)!;
  const [pinning, setPinning] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<{candidate: string; at: Vec2} | null>(null);
  const [draftText, setDraftText] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const up = useFamily.getState().updateGuest;
  const pack = g.pack;

  const addPin = () => {
    if (!draftAt || !draftText.trim()) return;
    const pin: Pin = {id: uid('p'), candidate: draftAt.candidate, at: draftAt.at, text: draftText.trim().slice(0, 200)};
    up({pins: [...g.pins, pin]});
    setDraftAt(null);
    setDraftText('');
    setLink(null);
  };

  const send = async () => {
    const reply: Reply = {v: 1, share: pack.id, author: g.author.trim() || '家人', pick: g.pick, pins: g.pins, at: Date.now()};
    setLink(linkFor('reply', await encodeData(reply)));
  };

  return (
    <div className="fm-page">
      <header className="fm-hero">
        <h1>{pack.from ? `${pack.from}想听听你的意见` : '帮忙看看这几个方案'}</h1>
        <p>{pack.question || '哪个方案住着更舒服？选一个最喜欢的，有想法就在图上点一下写下来。'}</p>
        <div className="fm-hero-name">
          <TextInput label="你是" placeholder="比如：妈妈" size="sm" value={g.author} onChange={(v) => (up({author: v.slice(0, 20)}), setLink(null))} />
        </div>
      </header>

      <div className="fm-grid">
        {pack.candidates.map((c, i) => {
          const mine = g.pins.filter((p) => p.candidate === c.id);
          const picked = g.pick === c.id;
          return (
            <article key={c.id} className={`fm-card${picked ? ' is-picked' : ''}`}>
              <header className="fm-card-head">
                <span className="fm-letter">{LETTERS[i]}</span>
                <h2>{c.name}</h2>
                <button
                  type="button"
                  className="fm-heart"
                  aria-pressed={picked}
                  onClick={() => (up({pick: picked ? null : c.id}), setLink(null))}
                >
                  {picked ? '♥ 最喜欢' : '♡ 选这个'}
                </button>
              </header>
              {c.note && <p className="fm-note">{c.note}</p>}
              <div className="fm-preview-wrap">
                <PlanPreview
                  plan={c.plan}
                  label={`${c.name}平面图`}
                  pins={mine.map((p, k) => ({id: p.id, at: p.at, label: String(k + 1), color: PIN_COLORS[0]!, title: p.text}))}
                  onPoint={pinning === c.id ? (at) => setDraftAt({candidate: c.id, at}) : undefined}
                />
                {pinning === c.id && !draftAt && <span className="fm-pin-tip">在图上点一下要说的地方</span>}
              </div>
              <Stats plan={c.plan} />
              {draftAt?.candidate === c.id && (
                <div className="fm-draft">
                  <TextArea label="想说什么" placeholder="比如：这里放个鞋柜，进门就能换鞋" value={draftText} onChange={setDraftText} rows={2} />
                  <div className="fm-row">
                    <Button label="留下" size="sm" variant="primary" onClick={addPin} isDisabled={!draftText.trim()} />
                    <Button label="取消" size="sm" variant="ghost" onClick={() => setDraftAt(null)} />
                  </div>
                </div>
              )}
              {mine.length > 0 && (
                <ol className="fm-pins">
                  {mine.map((p) => (
                    <li key={p.id}>
                      <span>{p.text}</span>
                      <button type="button" aria-label="删掉这条" onClick={() => (up({pins: g.pins.filter((x) => x.id !== p.id)}), setLink(null))}>
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <Button
                label={pinning === c.id ? '不留言了' : '在图上留言'}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPinning(pinning === c.id ? null : c.id);
                  setDraftAt(null);
                }}
              />
            </article>
          );
        })}
      </div>

      <footer className="fm-send">
        <span>
          {g.pick ? `最喜欢${pack.candidates.find((c) => c.id === g.pick)?.name ?? ''}` : '还没选最喜欢的'} · 留言 {g.pins.length} 条
        </span>
        {link ? (
          <LinkBox link={link} fileName="栖图-我的意见.txt" hint={`${g.author || '我'}对方案的意见，用栖图打开：`} />
        ) : (
          <Button label="把意见发回去" variant="primary" onClick={send} isDisabled={!g.pick && !g.pins.length} />
        )}
      </footer>
      <p className="np-hint fm-foot">
        这些方案只在你的浏览器里打开，不会上传。
        <button type="button" className="fm-link" onClick={() => useFamily.getState().leaveGuest()}>
          回到我自己的方案
        </button>
      </p>
    </div>
  );
}

/* ---------- 发起人：存候选、发链接、看大家的意见 ---------- */

function ShareResults({share}: {share: OwnedShare}) {
  const {pack, replies} = share;
  const votes = tally(pack, replies);
  const color = (author: string) => PIN_COLORS[replies.findIndex((r) => r.author === author) % PIN_COLORS.length]!;
  const top = Math.max(0, ...[...votes.values()].map((v) => v.length));
  return (
    <section className="fm-results" data-share={pack.id}>
      <header className="fm-results-head">
        <h3>{pack.question || '发给家人的方案'}</h3>
        <small>
          {new Date(pack.at).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})} · {replies.length ? `${replies.length} 人回复` : '还没人回复'}
        </small>
      </header>
      <div className="fm-grid">
        {pack.candidates.map((c, i) => {
          const v = votes.get(c.id) ?? [];
          const pins: PreviewPin[] = replies.flatMap((r) =>
            r.pins.filter((p) => p.candidate === c.id).map((p) => ({id: `${r.author}-${p.id}`, at: p.at, label: r.author.slice(0, 1), color: color(r.author), title: `${r.author}：${p.text}`})),
          );
          return (
            <article key={c.id} className={`fm-card${v.length && v.length === top ? ' is-picked' : ''}`}>
              <header className="fm-card-head">
                <span className="fm-letter">{LETTERS[i]}</span>
                <h2>{c.name}</h2>
                <span className="fm-votes">{v.length ? `♥ ${v.length}　${v.join('、')}` : '♡ 0'}</span>
              </header>
              <div className="fm-preview-wrap">
                <PlanPreview plan={c.plan} label={`${c.name}平面图`} pins={pins} />
              </div>
              {pins.length > 0 && (
                <ul className="fm-comments">
                  {pins.map((p) => (
                    <li key={p.id} style={{['--c' as string]: p.color}}>
                      {p.title}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                label="用这个方案继续改"
                size="sm"
                variant="secondary"
                onClick={() => {
                  usePlanStore.getState().commit(() => c.plan);
                  navigate('design');
                  toast(`已打开${c.name}，顶栏撤销可以退回`);
                }}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OwnerView() {
  const {candidates, shares, me} = useFamily();
  const plan = usePlanStore((s) => s.plan);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [question, setQuestion] = useState('哪个方案更好？选一个最喜欢的，有想法就在图上点一下留言。');
  const [link, setLink] = useState<{id: string; url: string} | null>(null);
  const [paste, setPaste] = useState('');
  const picked = chosen ?? candidates.slice(-4).map((c) => c.id);
  const fam = useFamily.getState();

  const saveCurrent = () => {
    const c = fam.saveCandidate(plan, `方案 ${LETTERS[candidates.length % LETTERS.length]}`);
    setChosen([...picked, c.id].slice(-4));
    toast(`当前设计存成了${c.name}`);
  };

  const create = async () => {
    const r = await fam.createShare(picked, from ?? me, question);
    setLink({id: r.pack.id, url: r.link});
  };

  const importPasted = async () => {
    try {
      await consumeLink(paste);
      setPaste('');
    } catch (e) {
      toast((e as Error).message, 'error', 4000);
    }
  };

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.addEventListener('change', async () => {
      const text = await input.files?.[0]?.text();
      if (text) await consumeLink(text).catch((e: Error) => toast(e.message, 'error', 4000));
    });
    input.click();
  };

  return (
    <div className="fm-page">
      <header className="fm-hero">
        <h1>和家人一起选</h1>
        <p>把几个方案存成候选，生成一条链接发到家里群。家人打开就能看、投票、在图上留言，再把意见用链接发回来。全程不用注册，方案不上传。</p>
      </header>

      <section className="fm-section">
        <div className="fm-section-head">
          <h2>候选方案</h2>
          <Button label="把当前设计存为候选" variant="primary" size="sm" onClick={saveCurrent} />
        </div>
        {candidates.length === 0 ? (
          <p className="fm-empty">还没有候选。在设计页调好一个方案，回来点上面的按钮存一份；换个摆法再存一份，就能让家人比一比。</p>
        ) : (
          <div className="fm-grid">
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                c={c}
                checked={picked.includes(c.id)}
                onCheck={(on) => setChosen(on ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
              />
            ))}
          </div>
        )}
      </section>

      {candidates.length > 0 && (
        <section className="fm-section">
          <h2>发给家人</h2>
          <div className="fm-form">
            <TextInput label="你的称呼" placeholder="比如：小维" size="sm" value={from ?? me} onChange={(v) => setFrom(v.slice(0, 20))} />
            <TextArea label="想问大家什么" value={question} onChange={(v) => setQuestion(v.slice(0, 100))} rows={2} />
            <Button label={`生成链接（${picked.length} 个方案）`} variant="primary" onClick={create} isDisabled={!picked.length || picked.length > 6} />
            {picked.length > 6 && <small className="np-hint">一次最多发 6 个方案</small>}
          </div>
          {link && <LinkBox link={link.url} fileName="栖图-一起选.txt" hint={`${from ?? me ?? ''}想听听你对新家方案的意见，用浏览器打开：`} />}
        </section>
      )}

      <section className="fm-section">
        <div className="fm-section-head">
          <h2>家人的意见</h2>
        </div>
        <div className="fm-import">
          <TextInput label="收到的回复链接" isLabelHidden placeholder="把家人发回来的链接粘贴到这里" size="sm" value={paste} onChange={setPaste} />
          <Button label="导入" size="sm" variant="secondary" onClick={importPasted} isDisabled={!paste.trim()} />
          <Button label="打开文件" size="sm" variant="ghost" onClick={openFile} />
        </div>
        {shares.length === 0 ? (
          <p className="fm-empty">发出链接后，家人点开就能投票。他们把意见发回来，直接点开那条链接，或者粘贴到上面，结果会汇总在这里。</p>
        ) : (
          shares.map((s) => <ShareResults key={s.pack.id} share={s} />)
        )}
      </section>
    </div>
  );
}

function CandidateCard({c, checked, onCheck}: {c: Candidate; checked: boolean; onCheck: (on: boolean) => void}) {
  const fam = useFamily.getState();
  return (
    <article className={`fm-card${checked ? ' is-checked' : ''}`}>
      <header className="fm-card-head">
        <CheckboxInput label={`发${c.name}`} isLabelHidden value={checked} onChange={onCheck} />
        <input className="fm-name" aria-label="方案名" value={c.name} onChange={(e) => fam.renameCandidate(c.id, e.target.value)} />
        <small>{new Date(c.savedAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</small>
      </header>
      <div className="fm-preview-wrap">
        <PlanPreview plan={c.plan} label={`${c.name}平面图`} />
      </div>
      <Stats plan={c.plan} />
      <div className="fm-row">
        <Button
          label="打开改"
          size="sm"
          variant="secondary"
          onClick={() => {
            usePlanStore.getState().commit(() => c.plan);
            navigate('design');
            toast(`已打开${c.name}，顶栏撤销可以退回`);
          }}
        />
        <Button label="删掉" size="sm" variant="ghost" onClick={() => fam.removeCandidate(c.id)} />
      </div>
    </article>
  );
}

export default function VotePage() {
  const loaded = useFamily((s) => s.loaded);
  const guest = useFamily((s) => s.guest);
  useIncomingLink();
  useEffect(() => {
    void useFamily.getState().load();
  }, []);
  if (!loaded && !guest) return <div className="np-loading">加载中…</div>;
  return <main className="fm-main">{guest ? <GuestView /> : <OwnerView />}</main>;
}

export type {SharePack};
