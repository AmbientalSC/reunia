/** What the user is asking about: a clicked keyword, a selected phrase or a follow-up question. */
export type AskKind = 'term' | 'selection' | 'followup';

export interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Sent to `api_ask_ai`. Field names are snake_case: this object is deserialized by serde as is. */
export interface AskRequest {
  query: string;
  kind: AskKind;
  context: string;
  history: AskTurn[];
  use_web: boolean;
}

export interface AskSource {
  title: string;
  url: string;
}

/** `searched`: the web was consulted. `off`: the user turned it off. `unavailable`: the provider cannot search. */
export type AskWebStatus = 'searched' | 'off' | 'unavailable';

export interface AskAnswer {
  markdown: string;
  sources: AskSource[];
  web: AskWebStatus;
  model_used: string;
}

/** A message of the conversation shown in the side panel. */
export type AskMessage =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; content: string; sources: AskSource[]; web: AskWebStatus; modelUsed: string };

/** What opens the panel: the question and the meeting context sent along with it. */
export interface AskOpenRequest {
  kind: Exclude<AskKind, 'followup'>;
  query: string;
  context: string;
}
