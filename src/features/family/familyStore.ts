import {create} from 'zustand';
import {idbGet, idbSet} from '../../lib/idb';
import {uid} from '../../lib/id';
import type {Plan} from '../../model/types';
import {encodeData, linkFor, mergeReply, type Candidate, type Pin, type Reply, type SharePack} from './share';

/** 发出去的一组候选，和收回来的回复 */
export interface OwnedShare {
  pack: SharePack;
  replies: Reply[];
}

/** 作为家人打开别人发来的方案时，自己的选择和留言 */
export interface GuestState {
  pack: SharePack;
  author: string;
  pick: string | null;
  pins: Pin[];
}

interface FamilyState {
  loaded: boolean;
  candidates: Candidate[];
  shares: OwnedShare[];
  guest: GuestState | null;
  /** 发起人的称呼，记住下次不用再填 */
  me: string;
  load: () => Promise<void>;
  saveCandidate: (plan: Plan, name: string) => Candidate;
  renameCandidate: (id: string, name: string) => void;
  removeCandidate: (id: string) => void;
  createShare: (ids: string[], from: string, question: string) => Promise<{pack: SharePack; link: string}>;
  /** 收到回复：返回对应的分享，找不到返回 null */
  importReply: (r: Reply) => OwnedShare | null;
  removeShare: (id: string) => void;
  openAsGuest: (pack: SharePack) => void;
  updateGuest: (change: Partial<Omit<GuestState, 'pack'>>) => void;
  leaveGuest: () => void;
}

const K = {candidates: 'family:candidates', shares: 'family:shares', guest: 'family:guest', me: 'family:me'};
const save = (key: string, v: unknown) => void idbSet(key, v).catch(() => {});

export const useFamily = create<FamilyState>()((set, get) => ({
  loaded: false,
  candidates: [],
  shares: [],
  guest: null,
  me: '',
  load: async () => {
    if (get().loaded) return;
    try {
      const [candidates, shares, guest, me] = await Promise.all([
        idbGet<Candidate[]>(K.candidates),
        idbGet<OwnedShare[]>(K.shares),
        idbGet<GuestState>(K.guest),
        idbGet<string>(K.me),
      ]);
      // 读取期间可能已经打开了别人的链接，以新的为准
      set((s) => ({loaded: true, candidates: candidates ?? [], shares: shares ?? [], guest: s.guest ?? guest ?? null, me: me ?? ''}));
    } catch {
      set({loaded: true});
    }
  },
  saveCandidate: (plan, name) => {
    const c: Candidate = {id: uid('c'), name: name.trim().slice(0, 20) || '方案', plan, savedAt: Date.now()};
    const candidates = [...get().candidates, c];
    set({candidates});
    save(K.candidates, candidates);
    return c;
  },
  renameCandidate: (id, name) => {
    const candidates = get().candidates.map((c) => (c.id === id ? {...c, name: name.slice(0, 20)} : c));
    set({candidates});
    save(K.candidates, candidates);
  },
  removeCandidate: (id) => {
    const candidates = get().candidates.filter((c) => c.id !== id);
    set({candidates});
    save(K.candidates, candidates);
  },
  createShare: async (ids, from, question) => {
    const picked = get().candidates.filter((c) => ids.includes(c.id));
    const pack: SharePack = {v: 1, id: uid('s'), from: from.trim().slice(0, 20), question: question.trim().slice(0, 100), candidates: picked, at: Date.now()};
    const link = linkFor('pack', await encodeData(pack));
    const shares = [{pack, replies: []}, ...get().shares];
    set({shares, me: pack.from});
    save(K.shares, shares);
    save(K.me, pack.from);
    return {pack, link};
  },
  importReply: (r) => {
    let hit: OwnedShare | null = null;
    const shares = get().shares.map((s) => {
      if (s.pack.id !== r.share) return s;
      hit = {...s, replies: mergeReply(s.replies, r)};
      return hit;
    });
    if (hit) {
      set({shares});
      save(K.shares, shares);
    }
    return hit;
  },
  removeShare: (id) => {
    const shares = get().shares.filter((s) => s.pack.id !== id);
    set({shares});
    save(K.shares, shares);
  },
  openAsGuest: (pack) => {
    const old = get().guest;
    // 同一个分享再打开一次，保留已经写的意见
    const guest: GuestState = old?.pack.id === pack.id ? {...old, pack} : {pack, author: old?.author ?? '', pick: null, pins: []};
    set({guest});
    save(K.guest, guest);
  },
  updateGuest: (change) => {
    const g = get().guest;
    if (!g) return;
    const guest = {...g, ...change};
    set({guest});
    save(K.guest, guest);
  },
  leaveGuest: () => {
    set({guest: null});
    void idbSet(K.guest, null).catch(() => {});
  },
}));
