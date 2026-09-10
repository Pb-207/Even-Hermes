import type { TurnEntry } from './history';
import type { HermesMessage } from './hermes';

export type Gesture = 'TAP' | 'SCROLL_UP' | 'SCROLL_DOWN' | 'DOUBLE_CLICK';

export type HomeItem =
  | { kind: 'new' }
  | { kind: 'turn'; turn: TurnEntry }
  | { kind: 'dir'; name: string }
  | { kind: 'session'; session: { id: string; title: string; preview?: string } };

export type Event =
  | { kind: 'reveal' }
  | { kind: 'phone_send'; text: string; images?: string[] }
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'stt_ok'; text: string }
  | { kind: 'stt_err'; message: string }
  | { kind: 'hermes_ok'; text: string }
  | { kind: 'hermes_err'; message: string }
  | { kind: 'hermes_delta'; text: string }
  | { kind: 'hermes_tool'; label: string | null }
  | { kind: 'set_conversation'; conversation: string }
  | { kind: 'home_loaded'; items: HomeItem[] }
  | { kind: 'menu_action'; itemID: number }
  | { kind: 'session_history_loaded'; messages: HermesMessage[] }
  | { kind: 'recording_timeout' }
  | { kind: 'device_disconnected' }
  | { kind: 'device_reconnected' }
  | { kind: 'tick' };

export type State =
  | { kind: 'home'; conversation: string; view: 'root' | 'folder' | 'desktop'; items: HomeItem[]; selectedIdx: number; loading?: boolean; confirmDelete?: boolean }
  | { kind: 'idle'; conversation: string; history?: HermesMessage[]; loading?: boolean; crumb?: string; desktop?: boolean }
  | { kind: 'recording'; conversation: string; startedAt: number; history?: HermesMessage[]; crumb?: string; desktop?: boolean }
  | { kind: 'transcribing'; conversation: string; history?: HermesMessage[]; crumb?: string; desktop?: boolean }
  | { kind: 'thinking'; conversation: string; transcript: string; toolLabel: string | null; history?: HermesMessage[]; crumb?: string; desktop?: boolean }
  | { kind: 'displaying'; conversation: string; transcript: string; reply: string; streaming: boolean; toolLabel: string | null; scrollOffset: number; crumb?: string; desktop?: boolean; reveal?: number }
  | { kind: 'disconnected'; conversation: string }
  | { kind: 'error'; conversation: string; message: string; lastTranscript: string };

export type Effect =
  | { kind: 'mic_on' }
  | { kind: 'mic_off' }
  | { kind: 'transcribe' }
  | { kind: 'send'; conversation: string; transcript: string; images?: string[] }
  | { kind: 'abort_inflight' }
  | { kind: 'exit_confirm' }
  | { kind: 'new_conversation' }
  | { kind: 'reload_history' }
  | { kind: 'reload_sessions' }
  | { kind: 'load_local_history'; conversation: string }
  | { kind: 'load_session_history'; conversation: string }
  | { kind: 'delete_session'; conversation: string }
  | { kind: 'render' };

export type Transition = { state: State; effects: Effect[] };

export function initialState(conversation: string): State {
  return { kind: 'home', conversation, view: 'root', items: [{ kind: 'dir', name: 'Desktop' }] /* Glasses 已停用 */, selectedIdx: 0 };
}

function clampIdx(items: HomeItem[], next: number): number {
  if (items.length === 0) return 0;
  if (next < 0) return 0;
  if (next > items.length - 1) return items.length - 1;
  return next;
}

function backToHome(state: State): Transition {
  return {
    state: { kind: 'home', conversation: state.conversation, view: 'root', items: [{ kind: 'dir', name: 'Desktop' }] /* Glasses 已停用 */, selectedIdx: 0 },
    effects: [
      { kind: 'mic_off' },
      { kind: 'abort_inflight' },
      { kind: 'reload_history' },
      { kind: 'render' },
    ],
  };
}

export function newConversationName(now: Date, seq: number): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const s = String(seq).padStart(2, '0');
  return `g2-${y}-${m}-${d}-${s}`;
}

function scrollUpReset(state: State): Transition {
  return {
    state: { kind: 'idle', conversation: state.conversation },
    effects: [{ kind: 'mic_off' }, { kind: 'abort_inflight' }, { kind: 'new_conversation' }, { kind: 'render' }],
  };
}

// Character-based scroll. Half-screen jump per spec is ~116px tall; in monospace
// body text on the 576px-wide framebuffer that maps to roughly 300 chars.
export const SCROLL_STEP_CHARS = 300;
const VISIBLE_CHARS = 950;

function scrollClamp(reply: string, next: number): number {
  const max = Math.max(0, reply.length - VISIBLE_CHARS);
  if (next < 0) return 0;
  if (next > max) return max;
  return next;
}

export function isReplyScrollable(reply: string): boolean {
  return reply.length > VISIBLE_CHARS;
}

export function reduce(state: State, event: Event): Transition {
  // Device disconnect is universal — drop everything in flight.
  if (event.kind === 'device_disconnected') {
    if (state.kind === 'disconnected') return { state, effects: [] };
    return {
      state: { kind: 'disconnected', conversation: state.conversation },
      effects: [{ kind: 'mic_off' }, { kind: 'abort_inflight' }, { kind: 'render' }],
    };
  }

  if (event.kind === 'device_reconnected') {
    if (state.kind === 'disconnected') {
      return {
        state: { kind: 'home', conversation: state.conversation, view: 'root', items: [{ kind: 'dir', name: 'Desktop' }] /* Glasses 已停用 */, selectedIdx: 0 },
                effects: [{ kind: 'reload_history' }, { kind: 'render' }],
      };
    }
    return { state, effects: [] };
  }

  // DOUBLE_CLICK semantics(统一,勿再重复添加分支):
  //  - disconnected → 退出确认
  //  - home(root) → 退出;home(folder/desktop) → 折叠回根目录
  //  - idle(会话历史页) → 返回上一级 Desktop 会话列表
  //  - displaying(回复页) → 回当前会话历史页(idle)并刷新历史
  //  - recording/transcribing/thinking(进行中) → 取消,回当前会话历史页(保留目录/历史)
  //  - 其他(error 等) → 回根目录
  if (event.kind === 'gesture' && event.gesture === 'DOUBLE_CLICK') {
    if (state.kind === 'disconnected') {
      return { state, effects: [{ kind: 'exit_confirm' }] };
    }
    if (state.kind === 'home') {
      if (state.view === 'folder' || state.view === 'desktop') {
        // 从目录内容折叠回根目录
        return {
          state: { kind: 'home', conversation: state.conversation, view: 'root', items: [{ kind: 'dir', name: 'Desktop' }] /* Glasses 已停用 */, selectedIdx: 0 },
          effects: [{ kind: 'render' }],
        };
      }
      return { state, effects: [{ kind: 'exit_confirm' }] };
    }
    if (state.kind === 'idle') {
      // 双击返回上一级:Desktop 会话列表
      return {
        state: { kind: 'home', conversation: state.conversation, view: 'desktop', items: [{ kind: 'new' }], selectedIdx: 0, loading: true },
        effects: [{ kind: 'reload_sessions' }, { kind: 'render' }],
      };
    }
    if (state.kind === 'displaying') {
      // 回复页 → 回当前会话历史页(idle)并刷新历史
      return {
        state: { kind: 'idle', conversation: state.conversation, loading: true, crumb: state.crumb, desktop: state.desktop },
        effects: [{ kind: 'load_session_history', conversation: state.conversation }, { kind: 'render' }],
      };
    }
    if (state.kind === 'recording' || state.kind === 'transcribing' || state.kind === 'thinking') {
      // 进行中(录音/转写/思考)→ 取消,回当前会话历史页(保留目录/历史)
      return {
        state: { kind: 'idle', conversation: state.conversation, history: state.history, crumb: state.crumb, desktop: state.desktop },
        effects: [{ kind: 'mic_off' }, { kind: 'abort_inflight' }, { kind: 'render' }],
      };
    }
    return backToHome(state);
  }

  // Disconnected swallows everything except double-click (handled above).
  if (state.kind === 'disconnected') {
    return { state, effects: [] };
  }

  // SCROLL_UP is universal — abort + new conversation. Exceptions:
  //  - `displaying`: scroll gestures scroll the reply
  //  - `home`: scroll gestures move the menu cursor (handled in the switch)
  //  - `idle` + history: 历史页,滑动只用容器滚动查看,不触发任何操作
  if (event.kind === 'gesture' && (event.gesture === 'SCROLL_UP' || event.gesture === 'SCROLL_DOWN')
      && state.kind === 'idle' && state.history && state.history.length) {
    return { state, effects: [] };
  }
  if (event.kind === 'gesture' && event.gesture === 'SCROLL_UP'
      && state.kind !== 'displaying' && state.kind !== 'home') {
    return scrollUpReset(state);
  }

  // set_conversation only takes effect in idle (no mid-conversation switching).
  if (event.kind === 'set_conversation' && state.kind === 'idle') {
    return {
      state: { kind: 'idle', conversation: event.conversation },
      effects: [{ kind: 'render' }],
    };
  }
  // 历史刷新:任意带 history 的会话态都更新;idle 时清除 loading(加载完成)
  if (event.kind === 'session_history_loaded' && state.kind === 'idle') {
    return {
      state: { ...state, history: event.messages, loading: false },
      effects: [{ kind: 'render' }],
    };
  }
  if (event.kind === 'phone_send') {
    // 手机端打字发送:与语音识别结果同一链路 → 眼镜端进入流式回复页
    if (state.kind === 'idle' || state.kind === 'displaying') {
      const conv = state.conversation;
      return {
        state: {
          kind: 'thinking', conversation: conv, transcript: event.text, toolLabel: null,
          history: (state as { history?: HermesMessage[] }).history,
          crumb: (state as { crumb?: string }).crumb,
          desktop: (state as { desktop?: boolean }).desktop,
        },
        effects: [
          { kind: 'send', conversation: conv, transcript: event.text, images: event.images },
          { kind: 'render' },
        ],
      };
    }
    // 其他状态(列表/录音中等)忽略
    return { state, effects: [] };
  }
  if (event.kind === 'session_history_loaded'
      && (state.kind === 'recording' || state.kind === 'transcribing'
          || state.kind === 'thinking' || state.kind === 'displaying')) {
    return {
      state: { ...state, history: event.messages },
      effects: [{ kind: 'render' }],
    };
  }

  switch (state.kind) {
    case 'home': {
      if (event.kind === 'menu_action') {
        const it = state.items[state.selectedIdx];
        if (state.view === 'desktop' && event.itemID === 1 && it?.kind === 'session') {
          return { state: { ...state, confirmDelete: true }, effects: [{ kind: 'render' }] };
        }
        return { state, effects: [] };
      }
      if (event.kind === 'home_loaded') {
        if (state.view === 'root') return { state, effects: [] };
        return {
          state: { ...state, items: event.items, selectedIdx: 0, loading: false },
          effects: [{ kind: 'render' }],
        };
      }
      if (event.kind === 'gesture' && event.gesture === 'SCROLL_UP') {
        const next = clampIdx(state.items, state.selectedIdx - 1);
        if (next === state.selectedIdx) return { state, effects: [] };
        return { state: { ...state, selectedIdx: next }, effects: [{ kind: 'render' }] };
      }
      if (event.kind === 'gesture' && event.gesture === 'SCROLL_DOWN') {
        const next = clampIdx(state.items, state.selectedIdx + 1);
        if (next === state.selectedIdx) return { state, effects: [] };
        return { state: { ...state, selectedIdx: next }, effects: [{ kind: 'render' }] };
      }
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        if (state.confirmDelete) {
          const it = state.items[state.selectedIdx];
          if (it?.kind === 'session') {
            return {
              state: { ...state, confirmDelete: false, loading: true },
              effects: [{ kind: 'delete_session', conversation: it.session.id }, { kind: 'render' }],
            };
          }
          return { state: { ...state, confirmDelete: false }, effects: [{ kind: 'render' }] };
        }
        if (state.view === 'root') {
          // 眼镜端(Glasses)已停用;根目录只进桌面端会话列表
          return {
            state: { ...state, view: 'desktop', items: [{ kind: 'new' }], selectedIdx: 0, loading: true },
            effects: [{ kind: 'render' }, { kind: 'reload_sessions' }],
          };
        }
        const item = state.items[state.selectedIdx];
        if (item?.kind === 'session') {
          // 选中桌面会话 → 进入 idle,conversation=桌面会话 id(续接),desktop=true
          return { state: { kind: 'idle', conversation: item.session.id, loading: true, crumb: '/Desktop/' + (item.session.title || item.session.id), desktop: true }, effects: [{ kind: 'load_session_history', conversation: item.session.id }, { kind: 'render' }] };
        }
        if (!item || item.kind === 'new') {
          // "+ new session" → fresh auto-generated conversation in idle.
          return {
            state: { kind: 'idle', conversation: state.conversation, crumb: state.view === 'desktop' ? '/Desktop' : '/Glasses', desktop: state.view === 'desktop' },
            effects: [{ kind: 'new_conversation' }, { kind: 'render' }],
          };
        }
        // Replay: land in displaying-done with the historical turn loaded.
        return {
          state: {
            kind: 'displaying',
            conversation: item.turn.conversation,
            transcript: item.turn.transcript,
            reply: item.turn.reply,
            streaming: false,
            toolLabel: null,
            scrollOffset: 0,
            reveal: 0,
            crumb: '/Glasses',
            desktop: false,
          },
          effects: [{ kind: 'render' }],
        };
      }
      return { state, effects: [] };
    }

    case 'idle':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        return {
          state: { kind: 'recording', conversation: state.conversation, startedAt: Date.now(), history: state.history, desktop: state.desktop, crumb: state.crumb },
          effects: [{ kind: 'mic_on' }, { kind: 'render' }],
        };
      }
      return { state, effects: [] };

    case 'recording':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        return {
          state: { kind: 'transcribing', conversation: state.conversation, history: state.history, desktop: state.desktop, crumb: state.crumb },
          effects: [{ kind: 'mic_off' }, { kind: 'transcribe' }, { kind: 'render' }],
        };
      }
      if (event.kind === 'recording_timeout') {
        return {
          state: { kind: 'transcribing', conversation: state.conversation, history: state.history, desktop: state.desktop, crumb: state.crumb },
          effects: [{ kind: 'mic_off' }, { kind: 'transcribe' }, { kind: 'render' }],
        };
      }
      return { state, effects: [] };

    case 'transcribing':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        return {
          state: { kind: 'idle', conversation: state.conversation },
          effects: [{ kind: 'abort_inflight' }, { kind: 'render' }],
        };
      }
      if (event.kind === 'stt_ok') {
        if (!event.text.trim()) {
          return {
            state: { kind: 'error', conversation: state.conversation, message: 'Heard nothing.', lastTranscript: '' },
            effects: [{ kind: 'render' }],
          };
        }
        return {
          state: { kind: 'thinking', conversation: state.conversation, transcript: event.text, toolLabel: null, history: state.history, desktop: state.desktop, crumb: state.crumb },
          effects: [{ kind: 'send', conversation: state.conversation, transcript: event.text }, { kind: 'render' }],
        };
      }
      if (event.kind === 'stt_err') {
        return {
          state: { kind: 'error', conversation: state.conversation, message: event.message, lastTranscript: '' },
          effects: [{ kind: 'render' }],
        };
      }
      return { state, effects: [] };

    case 'thinking':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        return {
          state: { kind: 'idle', conversation: state.conversation },
          effects: [{ kind: 'abort_inflight' }, { kind: 'render' }],
        };
      }
      if (event.kind === 'hermes_delta') {
        return {
          state: {
            kind: 'displaying',
            conversation: state.conversation,
            transcript: state.transcript,
            reply: event.text,
            streaming: true,
            toolLabel: state.toolLabel,
            scrollOffset: 0,
            reveal: 0,
            desktop: state.desktop,
            history: state.history,
            crumb: state.crumb,
          },
          effects: [{ kind: 'render' }],
        };
      }
      if (event.kind === 'hermes_tool') {
        return {
          state: { ...state, toolLabel: event.label },
          effects: [{ kind: 'render' }],
        };
      }
      if (event.kind === 'hermes_ok') {
        // 进入 B 页面(displaying):顶部显示识别文本,下方显示最新回复
        return {
          state: {
            kind: 'displaying',
            conversation: state.conversation,
            transcript: state.transcript,
            reply: event.text,
            streaming: false,
            toolLabel: null,
            scrollOffset: 0,
            reveal: 0,
            desktop: state.desktop,
            history: state.history,
            crumb: state.crumb,
          },
          effects: [{ kind: 'render' }],
        };
      }
      if (event.kind === 'hermes_err') {
        return {
          state: { kind: 'error', conversation: state.conversation, message: event.message, lastTranscript: state.transcript },
          effects: [{ kind: 'render' }],
        };
      }
      return { state, effects: [] };

    case 'displaying':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        if (state.desktop) {
          // 桌面会话 B 页:单击 → 回 A(历史页)+刷新历史+立即开始录音(listening)
          const fx: Effect[] = state.streaming ? [{ kind: 'abort_inflight' }] : [];
          fx.push(
            { kind: 'load_session_history', conversation: state.conversation },
            { kind: 'mic_on' },
            { kind: 'render' },
          );
          return {
            state: { kind: 'recording', conversation: state.conversation, startedAt: Date.now(), history: state.history, desktop: true, crumb: state.crumb },
            effects: fx,
          };
        }
        // Streaming: tap interrupts the in-flight stream AND starts a new utterance.
        // Done: tap just starts a new utterance.
        const effects: Effect[] = state.streaming
          ? [{ kind: 'abort_inflight' }, { kind: 'mic_on' }, { kind: 'render' }]
          : [{ kind: 'mic_on' }, { kind: 'render' }];
        return {
          state: { kind: 'recording', conversation: state.conversation, startedAt: Date.now() },
          effects,
        };
      }
      // Scroll gestures only do anything when the reply is finalized and overflows.
      if (!state.streaming && event.kind === 'gesture' && event.gesture === 'SCROLL_UP') {
        if (!isReplyScrollable(state.reply)) return { state, effects: [] };
        const next = scrollClamp(state.reply, state.scrollOffset + SCROLL_STEP_CHARS);
        if (next === state.scrollOffset) return { state, effects: [] };
        return { state: { ...state, scrollOffset: next }, effects: [{ kind: 'render' }] };
      }
      if (!state.streaming && event.kind === 'gesture' && event.gesture === 'SCROLL_DOWN') {
        if (!isReplyScrollable(state.reply)) return { state, effects: [] };
        const next = scrollClamp(state.reply, state.scrollOffset - SCROLL_STEP_CHARS);
        if (next === state.scrollOffset) return { state, effects: [] };
        return { state: { ...state, scrollOffset: next }, effects: [{ kind: 'render' }] };
      }
      if (event.kind === 'reveal') {
        // 打字机:显示端逐字追上已到达的全文(与网络/推理节奏解耦)
        const full = state.reply.length;
        const cur = state.reveal ?? 0;
        if (cur >= full) return { state, effects: [] };
        const step = Math.min(8, Math.max(1, Math.ceil((full - cur) / 40))); // 打字机:剩余/40(比 /20 慢一半),每拍上限 8 字以免长文本忽快
        return { state: { ...state, reveal: Math.min(full, cur + step) }, effects: [{ kind: 'render' }] };
      }
      if (state.streaming && event.kind === 'hermes_delta') {
        return {
          state: { ...state, reply: state.reply + event.text },
          effects: [{ kind: 'render' }],
        };
      }
      if (state.streaming && event.kind === 'hermes_tool') {
        return {
          state: { ...state, toolLabel: event.label },
          effects: [{ kind: 'render' }],
        };
      }
      if (state.streaming && event.kind === 'hermes_ok') {
        return {
          state: { ...state, streaming: false, reply: event.text, toolLabel: null },
          effects: [{ kind: 'render' }],
        };
      }
      if (state.streaming && event.kind === 'hermes_err') {
        return {
          state: { kind: 'error', conversation: state.conversation, message: event.message, lastTranscript: state.transcript },
          effects: [{ kind: 'render' }],
        };
      }
      return { state, effects: [] };

    case 'error':
      if (event.kind === 'gesture' && event.gesture === 'TAP') {
        if (state.lastTranscript) {
          return {
            state: { kind: 'thinking', conversation: state.conversation, transcript: state.lastTranscript, toolLabel: null },
            effects: [
              { kind: 'send', conversation: state.conversation, transcript: state.lastTranscript },
              { kind: 'render' },
            ],
          };
        }
        return { state: { kind: 'idle', conversation: state.conversation }, effects: [{ kind: 'render' }] };
      }
      return { state, effects: [] };
  }
}
